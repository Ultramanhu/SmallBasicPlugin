// <copyright file="SignatureHelpProviderTests.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Tests.Services
{
    using System.Linq;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Utilities.Resources;
    using Xunit;

    public sealed class SignatureHelpProviderTests : IClassFixture<CultureFixture>
    {
        [Fact]
        public void ShowsTheSignatureRightAfterTheOpeningParen()
        {
            SignatureHelp help = GetHelp("x = Math.GetRandomNumber($)");

            help.ActiveSignature.Should().Be(0);
            help.ActiveParameter.Should().Be(0);

            SignatureInformation signature = help.Signatures.Single();
            signature.Label.Should().Be("Math.GetRandomNumber(maxNumber)");
            signature.Documentation.Should().Be(LibrariesResources.Math_GetRandomNumber);
            signature.Parameters.Single().Label.Should().Be("maxNumber");
            signature.Parameters.Single().Documentation.Should().Be(LibrariesResources.Math_GetRandomNumber_maxNumber);
        }

        [Fact]
        public void MarksTheParameterAfterANestedCallCloses()
        {
            SignatureHelp help = GetHelp("Shapes.Move(name, Math.Max(1, 2), $)");

            help.ActiveParameter.Should().Be(2);
            help.Signatures.Single().Label.Should().Be("Shapes.Move(shapeName, x, y)");
        }

        [Fact]
        public void MatchesNamesInACaseInsensitiveManner()
        {
            SignatureHelp help = GetHelp("math.getrandomnumber($)");

            help.Signatures.Single().Label.Should().Be("Math.GetRandomNumber(maxNumber)");
        }

        [Fact]
        public void ReturnsNullOutsideAnArgumentList()
        {
            GetHelp("x = Math.GetRandomNumber(5)$").Should().BeNull();
            GetHelp("DoWork($)").Should().BeNull();
            GetHelp("$").Should().BeNull();
        }

        private static SignatureHelp GetHelp(string text)
        {
            var markerCompilation = new SmallBasicCompilation(text);
            var marker = markerCompilation.Diagnostics.Single(d => d.Code == DiagnosticCode.UnrecognizedCharacter && d.Args.Single() == "$");

            var start = marker.Range.Start;
            var end = marker.Range.End;
            start.Line.Should().Be(end.Line);
            start.Column.Should().Be(end.Column);

            return SignatureHelpProvider.Provide(text.Replace("$", string.Empty, System.StringComparison.CurrentCulture), start);
        }
    }
}
