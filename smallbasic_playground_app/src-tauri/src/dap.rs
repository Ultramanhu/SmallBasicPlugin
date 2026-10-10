//! Minimal DAP wire helpers (doc 10, §18.2).
//!
//! The Rust layer owns `Content-Length` framing and request sequence numbers
//! so the page never touches raw stdin/stdout. Incoming bytes are parsed
//! incrementally; multi-byte UTF-8 split across reads is handled by the
//! caller for run sessions, while DAP frames are reassembled byte-exact here.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Writes DAP requests to the adapter's stdin with automatic sequence numbers.
pub struct DapFramer {
    sink: Mutex<Box<dyn Write + Send>>,
    seq: AtomicU64,
}

impl DapFramer {
    pub fn new(sink: Box<dyn Write + Send>) -> Self {
        Self {
            sink: Mutex::new(sink),
            seq: AtomicU64::new(0),
        }
    }

    /// Sends one DAP request and returns the sequence number used, so the
    /// frontend can correlate the eventual response (`request_seq`).
    pub fn send(&self, command: &str, args: &serde_json::Value) -> std::io::Result<u64> {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let body = serde_json::json!({
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": args,
        });
        let text = body.to_string();
        let mut sink = self.sink.lock().expect("dap sink poisoned");
        write!(sink, "Content-Length: {}\r\n\r\n{}", text.as_bytes().len(), text)?;
        sink.flush()?;
        Ok(seq)
    }
}

/// Incrementally extracts complete DAP messages from adapter stdout bytes.
pub struct DapParser {
    buffer: Vec<u8>,
}

const MAX_ORPHAN_BUFFER_BYTES: usize = 1024 * 1024;

impl DapParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<serde_json::Value> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        while let Some(frame) = self.next_frame() {
            match serde_json::from_slice::<serde_json::Value>(&frame) {
                Ok(value) => messages.push(value),
                // A malformed body must not wedge the stream; drop it.
                Err(_) => continue,
            }
        }
        if self.buffer.len() > MAX_ORPHAN_BUFFER_BYTES {
            // No header terminator in sight: the adapter is not speaking DAP.
            self.buffer.clear();
        }
        messages
    }

    fn next_frame(&mut self) -> Option<Vec<u8>> {
        let header_end = find_subsequence(&self.buffer, b"\r\n\r\n")?;
        let headers = String::from_utf8_lossy(&self.buffer[..header_end]);
        let mut content_length: Option<usize> = None;
        for line in headers.split("\r\n") {
            let lowered = line.to_ascii_lowercase();
            if let Some(rest) = lowered.strip_prefix("content-length:") {
                content_length = rest.trim().parse::<usize>().ok();
            }
        }

        let length = content_length?;
        let body_start = header_end + 4;
        if self.buffer.len() < body_start + length {
            return None;
        }

        let body = self.buffer[body_start..body_start + length].to_vec();
        self.buffer.drain(..body_start + length);
        Some(body)
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// Incremental UTF-8 decoder for piped process output (doc 10, §18.2):
/// bytes that end mid-character are kept for the next read.
#[derive(Default)]
pub struct Utf8Accumulator {
    pending: Vec<u8>,
}

impl Utf8Accumulator {
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        match std::str::from_utf8(&self.pending) {
            Ok(text) => {
                let out = text.to_string();
                self.pending.clear();
                out
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    let out = String::from_utf8_lossy(&self.pending[..valid]).into_owned();
                    self.pending.drain(..valid);
                    return out;
                }

                match error.error_len() {
                    // Incomplete sequence at the end of the buffer: wait.
                    None => String::new(),
                    // Genuinely invalid bytes: drop them to keep flowing.
                    Some(bad) => {
                        self.pending.drain(..bad);
                        String::new()
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_reassembles_split_frames() {
        let body = br#"{"seq":1,"type":"event","event":"initialized"}"#;
        let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
        frame.extend_from_slice(body);
        let mut parser = DapParser::new();

        assert!(parser.push(&frame[..10]).is_empty());
        let messages = parser.push(&frame[10..]);
        assert!(parser.push(body).is_empty());
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["event"], "initialized");
    }

    #[test]
    fn decoder_holds_partial_characters() {
        let mut decoder = Utf8Accumulator::default();
        let bytes = "你好".as_bytes();
        assert_eq!(decoder.push(&bytes[..2]), "");
        assert_eq!(decoder.push(&bytes[2..4]), "你");
        assert_eq!(decoder.push(&bytes[4..]), "好");
    }
}

