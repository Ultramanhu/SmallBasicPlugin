namespace SmallBasic.Vsix.Editor.Classification
{
    using System;
    using System.Collections.Generic;
    using Microsoft.VisualStudio.Text;

    internal static class SmallBasicSimpleLexer
    {
        private static readonly HashSet<string> Keywords = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "If", "Then", "Else", "ElseIf", "EndIf", "For", "To", "Step", "EndFor", "GoTo", "While", "EndWhile", "Sub", "EndSub", "Function", "EndFunction", "Dim", "Return", "And", "Or",
        };

        private static readonly HashSet<string> Libraries = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Array", "Clock", "Controls", "Dictionary", "File", "Flickr", "GraphicsWindow", "ImageList", "Math", "Mouse", "Network", "Program", "Shapes", "Sound", "Stack", "Text", "TextWindow", "Timer", "Turtle",
        };

        public static IEnumerable<SmallBasicTokenSpan> Scan(ITextSnapshot snapshot)
        {
            foreach (ITextSnapshotLine line in snapshot.Lines)
            {
                string text = line.GetText();
                int index = 0;
                while (index < text.Length)
                {
                    char current = text[index];
                    if (current == '\'')
                    {
                        yield return new SmallBasicTokenSpan(line.Start.Position + index, text.Length - index, SmallBasicClassificationNames.Comment);
                        break;
                    }

                    if (current == '"')
                    {
                        int end = index + 1;
                        while (end < text.Length && text[end] != '"')
                        {
                            end++;
                        }

                        if (end < text.Length)
                        {
                            end++;
                        }

                        yield return new SmallBasicTokenSpan(line.Start.Position + index, end - index, SmallBasicClassificationNames.String);
                        index = end;
                        continue;
                    }

                    if (char.IsDigit(current))
                    {
                        int end = index + 1;
                        while (end < text.Length && (char.IsDigit(text[end]) || text[end] == '.'))
                        {
                            end++;
                        }

                        yield return new SmallBasicTokenSpan(line.Start.Position + index, end - index, SmallBasicClassificationNames.Number);
                        index = end;
                        continue;
                    }

                    if (current == '_' || char.IsLetter(current))
                    {
                        int end = index + 1;
                        while (end < text.Length && (text[end] == '_' || char.IsLetterOrDigit(text[end])))
                        {
                            end++;
                        }

                        string word = text.Substring(index, end - index);
                        if (Keywords.Contains(word))
                        {
                            yield return new SmallBasicTokenSpan(line.Start.Position + index, end - index, SmallBasicClassificationNames.Keyword);
                        }
                        else if (Libraries.Contains(word))
                        {
                            yield return new SmallBasicTokenSpan(line.Start.Position + index, end - index, SmallBasicClassificationNames.Library);
                        }
                        else
                        {
                            // Plain identifiers are surfaced so the classifier can
                            // colour the ones that name a procedure; everything else
                            // keeps the default foreground.
                            yield return new SmallBasicTokenSpan(line.Start.Position + index, end - index, SmallBasicClassificationNames.Identifier);
                        }

                        index = end;
                        continue;
                    }

                    index++;
                }
            }
        }
    }

    internal readonly struct SmallBasicTokenSpan
    {
        public SmallBasicTokenSpan(int start, int length, string classificationName)
        {
            this.Start = start;
            this.Length = length;
            this.ClassificationName = classificationName;
        }

        public int Start { get; }

        public int Length { get; }

        public string ClassificationName { get; }
    }
}
