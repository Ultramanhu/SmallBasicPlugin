namespace SmallBasic.Tests.Runtime
{
    using System.Linq;
    using System.Threading.Tasks;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using Xunit;

    public sealed class ArithmeticOperatorsTests : IClassFixture<CultureFixture>
    {
        [Fact]
        public async Task ItComputesIntegerDivisionTruncatingTowardZero()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 7 \ 2
b = -7 \ 2
c = 8 \ 2
d = 7.9 \ 2.9").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("3");
            snapshot["b"].ToDisplayString().Should().Be("-3");
            snapshot["c"].ToDisplayString().Should().Be("4");
            snapshot["d"].ToDisplayString().Should().Be("2");
        }

        [Fact]
        public async Task ItYieldsZeroForIntegerDivisionByZeroAndKeepsRunning()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 4 \ 0
b = ""after""").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("0");
            snapshot["b"].ToDisplayString().Should().Be("after");
        }

        [Fact]
        public async Task ItComputesModuloWithTheDividendSign()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 7 Mod 2
b = -7 Mod 2
c = 7.5 Mod 2
d = 8 Mod 2").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("1");
            snapshot["b"].ToDisplayString().Should().Be("-1");
            snapshot["c"].ToDisplayString().Should().Be("1.5");
            snapshot["d"].ToDisplayString().Should().Be("0");
        }

        [Fact]
        public async Task ItHandlesNegativeDivisorsConsistently()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 7 \ -2
b = -7 \ -2
c = 7 Mod -2
d = -7 Mod -2").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("-3");
            snapshot["b"].ToDisplayString().Should().Be("3");
            snapshot["c"].ToDisplayString().Should().Be("1");
            snapshot["d"].ToDisplayString().Should().Be("-1");
        }

        [Fact]
        public async Task ItYieldsZeroForModuloByZeroAndKeepsRunning()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 4 Mod 0
b = ""after""").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("0");
            snapshot["b"].ToDisplayString().Should().Be("after");
        }

        [Fact]
        public async Task ItFollowsTheVisualBasicPrecedenceLadder()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 6 Mod 4 * 2
b = 7 \ 2 * 3
c = 12 \ 4 Mod 3
d = 8 - 3 Mod 2").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("6");
            snapshot["b"].ToDisplayString().Should().Be("1");
            snapshot["c"].ToDisplayString().Should().Be("0");
            snapshot["d"].ToDisplayString().Should().Be("7");
        }

        [Fact]
        public async Task ItTreatsIntegerDivisionAsLeftAssociative()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 8 \ 2 \ 2").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["a"].ToDisplayString().Should().Be("2");
        }

        [Fact]
        public async Task ItRecognizesModCaseInsensitively()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = 7 mOd 2").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["a"].ToDisplayString().Should().Be("1");
        }

        [Fact]
        public async Task MathDivAndMathModMatchTheOperators()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
a = Math.Div(7, 2)
b = Math.Div(-7, 2)
c = Math.Mod(7, 2)
d = Math.Mod(-7, 2)
e = Math.Div(9, 0)
f = Math.Mod(9, 0)
g = Math.Mod(Math.Div(17, 5), 2)").VerifyRealRuntime().ConfigureAwait(false);

            var snapshot = engine.GetSnapshot().Memory;
            snapshot["a"].ToDisplayString().Should().Be("3");
            snapshot["b"].ToDisplayString().Should().Be("-3");
            snapshot["c"].ToDisplayString().Should().Be("1");
            snapshot["d"].ToDisplayString().Should().Be("-1");
            snapshot["e"].ToDisplayString().Should().Be("0");
            snapshot["f"].ToDisplayString().Should().Be("0");
            snapshot["g"].ToDisplayString().Should().Be("1");
        }

        [Fact]
        public void ItTreatsModAsAReservedWord()
        {
            var compilation = new SmallBasicCompilation("Mod = 1");

            compilation.Diagnostics.Should().NotBeEmpty();
        }

        [Fact]
        public void ItKeepsLibraryMemberAccessWorkingWithTheModKeyword()
        {
            var compilation = new SmallBasicCompilation("a = Math.Mod(7, 2)");

            compilation.Diagnostics.Should().BeEmpty();
        }

        [Fact]
        public void ItProvidesHoverForModAndBackslashOperators()
        {
            var compilation = new SmallBasicCompilation(
                "answer = 7 Mod 2\n" +
                "other = 7 \\ 2");

            compilation.ProvideHover((0, 11)).Should().Equal(
                "Mod",
                "Returns the remainder of dividing the left number by the right one, with the same sign as the dividend. Dividing by zero returns 0.");
            compilation.ProvideHover((1, 10)).Should().Equal(
                "\\",
                "Integer division: divides the left number by the right one and truncates the quotient toward zero. Dividing by zero returns 0.");
        }

        [Fact]
        public void ItProvidesLibraryHoverForMathModRatherThanOperatorHover()
        {
            var compilation = new SmallBasicCompilation("answer = Math.Mod(7, 2)");

            compilation.ProvideHover((0, 15)).Should().Equal(
                "Math.Mod(dividend, divisor)",
                "Divides the first number by the second and returns the remainder, with the same sign as the dividend. For example, Math.Mod(7, 2) returns 1 and Math.Mod(-7, 2) returns -1. Dividing by zero returns 0.",
                "dividend: The number to divide.",
                "divisor: The number that divides.");
        }

        [Fact]
        public void ArithmeticOperatorLinesAreExecutableForTheDebugger()
        {
            var compilation = new SmallBasicCompilation(
                "Value = 17\n" +
                "Whole = Value \\ 5\n" +
                "Rest = Value Mod 5");

            compilation.Diagnostics.Should().BeEmpty();
            compilation.GetExecutableLines().Should().Contain(new[] { 0, 1, 2 });
        }
    }
}
