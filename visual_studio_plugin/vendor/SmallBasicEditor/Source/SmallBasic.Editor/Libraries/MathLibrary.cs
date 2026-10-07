// <copyright file="MathLibrary.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Editor.Libraries
{
    using System;
    using System.Globalization;
    using SmallBasic.Compiler.Runtime;

    internal sealed class MathLibrary : IMathLibrary
    {
        private static readonly Random Random = new Random((int)DateTime.Now.Ticks);

        public decimal Get_Pi() => FromDouble(Math.PI);

        public decimal Abs(decimal number) => Math.Abs(number);

        public decimal ArcCos(decimal cosValue) => cosValue < -1 || cosValue > 1
            ? throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidMathOperation)
            : FromDouble(Math.Acos((double)cosValue));

        public decimal ArcSin(decimal sinValue) => sinValue < -1 || sinValue > 1
            ? throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidMathOperation)
            : FromDouble(Math.Asin((double)sinValue));

        public decimal ArcTan(decimal tanValue) => FromDouble(Math.Atan((double)tanValue));

        public decimal Ceiling(decimal number) => Math.Ceiling(number);

        public decimal Cos(decimal angle) => FromDouble(Math.Cos((double)angle));

        public decimal Div(decimal dividend, decimal divisor)
        {
            RequireNonZeroDivisor(divisor);
            return decimal.Truncate(dividend / divisor);
        }

        public decimal Floor(decimal number) => Math.Floor(number);

        public decimal GetDegrees(decimal angle) => FromDouble(180 * (double)angle / Math.PI % 360);

        public decimal GetRadians(decimal angle) => FromDouble((double)angle % 360 * Math.PI / 180);

        public decimal GetRandomNumber(decimal maxNumber) => Random.Next((int)Math.Max(1, maxNumber)) + 1;

        public decimal Log(decimal number) => number <= 0
            ? throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidMathOperation)
            : FromDouble(Math.Log10((double)number));

        public decimal Max(decimal number1, decimal number2) => Math.Max(number1, number2);

        public decimal Min(decimal number1, decimal number2) => Math.Min(number1, number2);

        public decimal Mod(decimal dividend, decimal divisor)
        {
            RequireNonZeroDivisor(divisor);
            return dividend % divisor;
        }

        public decimal NaturalLog(decimal number) => number <= 0
            ? throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidMathOperation)
            : FromDouble(Math.Log((double)number));

        public decimal Power(decimal baseNumber, decimal exponent) => FromDouble(Math.Pow((double)baseNumber, (double)exponent));

        public decimal Remainder(decimal dividend, decimal divisor)
        {
            RequireNonZeroDivisor(divisor);
            return dividend % divisor;
        }

        public decimal Round(decimal number) => Math.Round(number);

        public decimal Sin(decimal angle) => FromDouble(Math.Sin((double)angle));

        public decimal SquareRoot(decimal number) => number < 0
            ? throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidMathOperation)
            : FromDouble(Math.Sqrt((double)number));

        public decimal Tan(decimal angle) => FromDouble(Math.Tan((double)angle));

        private static decimal RequireNonZeroDivisor(decimal divisor)
        {
            if (divisor == 0)
            {
                throw new SmallBasicRuntimeException((int)RuntimeErrorCode.DivideByZero);
            }

            return divisor;
        }

        /*
         * The JavaScript backend computes the transcendental functions with double
         * and prints the shortest round-trippable form, so the results travel
         * through that same text here: Math.Pi becomes 3.141592653589793 instead of
         * the full 28 digit decimal expansion, and Math.SquareRoot(2) matches too.
         * Domain violations (Math.SquareRoot(-4), Math.ArcCos(2), Math.Log(0))
         * are reported above as 1002 invalid math operation. Any remaining
         * non-finite result (NaN, infinity, anything outside the decimal range
         * - for example Math.Power(0, -1)) is a 1003 invalid numeric result.
         */
        private static decimal FromDouble(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidNumericResult);
            }

            if (!decimal.TryParse(
                ToRoundTripString(value),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out decimal result))
            {
                throw new SmallBasicRuntimeException((int)RuntimeErrorCode.InvalidNumericResult);
            }

            return result;
        }

        /*
         * The shortest text that still round-trips through double, which is what the
         * JavaScript backend prints. .NET Framework's "R" keeps all 17 digits (Math.Pi
         * would come out as 3.1415926535897931), so the precision is lowered until the
         * text stops round-tripping.
         */
        private static string ToRoundTripString(double value)
        {
            for (int precision = 1; precision < 17; precision++)
            {
                string candidate = value.ToString("G" + precision.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
                if (double.TryParse(candidate, NumberStyles.Float, CultureInfo.InvariantCulture, out double roundTripped) && roundTripped == value)
                {
                    return candidate;
                }
            }

            return value.ToString("R", CultureInfo.InvariantCulture);
        }
    }
}
