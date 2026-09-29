using System.Runtime.CompilerServices;

// The shared Visual Studio integration layer is not a standalone product: its types
// are an implementation detail of the two Visual Studio packages that consume it.
// Keeping them internal (rather than public) documents that contract while still
// letting both packages compile against the exact same implementation.
//
//   * SmallBasic.Vsix - classic VSSDK + MEF extension
//   * SmallBasic.Ext  - VisualStudio.Extensibility extension (+ VSSDK compatibility)
[assembly: InternalsVisibleTo("SmallBasic.Vsix")]
[assembly: InternalsVisibleTo("SmallBasic.Ext")]
