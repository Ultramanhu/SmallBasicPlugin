using System.Collections.Concurrent;

namespace SmallBasic.Blazor.RunHost.Hosting;

public sealed class SessionStore
{
    private readonly ConcurrentDictionary<string, BlazorHostSession> sessions = new(StringComparer.Ordinal);

    public void Add(BlazorHostSession session)
    {
        if (!this.sessions.TryAdd(session.Descriptor.Id, session))
        {
            throw new InvalidOperationException("A duplicate Blazor RunHost session id was generated.");
        }
    }

    public bool TryGet(string id, out BlazorHostSession? session) => this.sessions.TryGetValue(id, out session);
}
