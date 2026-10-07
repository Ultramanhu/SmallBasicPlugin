// <copyright file="RuntimeError.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    using System;

    /// <summary>
    /// The stable runtime error codes shared with the TypeScript engine. A
    /// runtime error is reported as `[Runtime Error] <code>: <message>` on the
    /// console and passed to `On Error GoSub` handlers as (code, message).
    /// </summary>
    public enum RuntimeErrorCode
    {
        DivideByZero = 1001,
        InvalidMathOperation = 1002,
        InvalidNumericResult = 1003,
        EmptyStack = 1101,
        UnsupportedLibraryOperation = 1901,
        InternalRuntimeError = 1999,
    }

    public static class RuntimeErrorMessages
    {
        public static string GetDefaultMessage(int code)
        {
            switch ((RuntimeErrorCode)code)
            {
                case RuntimeErrorCode.DivideByZero: return "Divide by zero.";
                case RuntimeErrorCode.InvalidMathOperation: return "Invalid math operation.";
                case RuntimeErrorCode.InvalidNumericResult: return "Invalid numeric result.";
                case RuntimeErrorCode.EmptyStack: return "This stack has no elements to be popped.";
                case RuntimeErrorCode.UnsupportedLibraryOperation: return "This library is not supported by the current host.";
                case RuntimeErrorCode.InternalRuntimeError: return "Internal runtime error.";
                default: return "Runtime error.";
            }
        }
    }

    /// <summary>A runtime error carried by a <see cref="SmallBasicRuntimeException"/>.</summary>
    public sealed class RuntimeError
    {
        public RuntimeError(int code, string message)
        {
            this.Code = code;
            this.Message = message;
        }

        public int Code { get; }

        public string Message { get; }

        public string ToDisplayString() => $"[Runtime Error] {this.Code}: {this.Message}";
    }

    /// <summary>
    /// Thrown by instructions and libraries to report a runtime error; the
    /// engine's execution loop catches it and applies the current `On Error`
    /// policy (abort / resume next / GoSub handler).
    /// </summary>
    public sealed class SmallBasicRuntimeException : Exception
    {
        public SmallBasicRuntimeException(int code, string message = null)
            : base(message ?? RuntimeErrorMessages.GetDefaultMessage(code))
        {
            this.Error = new RuntimeError(code, this.Message);
        }

        public RuntimeError Error { get; }
    }
}
