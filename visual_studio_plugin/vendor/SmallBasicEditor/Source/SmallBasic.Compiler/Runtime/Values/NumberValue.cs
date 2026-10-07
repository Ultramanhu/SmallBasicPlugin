// <copyright file="NumberValue.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    using System.Globalization;

    public sealed class NumberValue : BaseValue
    {
        public NumberValue(decimal value)
        {
            this.Value = value;
        }

        public decimal Value { get; private set; }

        // decimal remembers the scale of a computation (2.5m + 2.5m == 5.0m) while
        // the JavaScript backend prints the shortest form, so a trailing fraction of
        // zeros is dropped: 5.0 displays as "5" and 2.50 as "2.5". The invariant
        // culture keeps the decimal point "." on every machine.
        public override string ToDisplayString()
        {
            string text = this.Value.ToString(CultureInfo.InvariantCulture);
            if (text.IndexOf('.') >= 0)
            {
                text = text.TrimEnd('0').TrimEnd('.');
            }

            return text;
        }

        internal override bool ToBoolean() => false;

        internal override decimal ToNumber() => this.Value;

        internal override ArrayValue ToArray() => new ArrayValue();
    }
}
