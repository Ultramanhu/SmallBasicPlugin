// <copyright file="OnErrorAction.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    /// <summary>
    /// The engine-level `On Error ...` policies. <see cref="GoToDefault"/> and
    /// <see cref="GoToClear"/> both restore the terminate-on-error behavior and
    /// drop any registered handler.
    /// </summary>
    public enum OnErrorAction
    {
        ResumeNext,
        GoToDefault,
        GoToClear,
        GoSub,
    }
}
