namespace SmallBasic.Vsix.Editor
{
    using System.ComponentModel.Composition;
    using Microsoft.VisualStudio.LanguageServer.Client;
    using Microsoft.VisualStudio.Utilities;

    internal static class ContentTypeDefinitions
    {
        [Export]
        [Name("smallbasic")]
        [BaseDefinition(CodeRemoteContentDefinition.CodeRemoteContentTypeName)]
        internal static ContentTypeDefinition SmallBasicContentType = null;

        [Export]
        [FileExtension(".sb")]
        [ContentType("smallbasic")]
        internal static FileExtensionToContentTypeDefinition SmallBasicFileExtension = null;
    }
}
