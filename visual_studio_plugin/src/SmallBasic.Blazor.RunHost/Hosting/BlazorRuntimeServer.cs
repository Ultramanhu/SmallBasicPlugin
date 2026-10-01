using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using SmallBasic.Blazor.Shared;

namespace SmallBasic.Blazor.RunHost.Hosting;

public sealed class BlazorRuntimeServer : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly SessionStore sessions;

    private BlazorRuntimeServer(WebApplication app, SessionStore sessions, string baseAddress)
    {
        this.app = app;
        this.sessions = sessions;
        this.BaseAddress = baseAddress.TrimEnd('/');
    }

    public string BaseAddress { get; }

    public static async Task<BlazorRuntimeServer> StartAsync(bool quiet, CancellationToken cancellationToken = default)
    {
        var options = new WebApplicationOptions
        {
            ApplicationName = typeof(BlazorRuntimeServer).Assembly.FullName,
            ContentRootPath = AppContext.BaseDirectory,
        };
        WebApplicationBuilder builder = WebApplication.CreateBuilder(options);
        if (quiet)
        {
            builder.Logging.ClearProviders();
        }

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var sessions = new SessionStore();
        builder.Services.AddSingleton(sessions);
        WebApplication app = builder.Build();
        app.UseWebSockets();
        app.UseBlazorFrameworkFiles();
        app.UseStaticFiles();
        app.MapGet("/api/sessions/{id}", (string id, SessionStore store) =>
            store.TryGet(id, out BlazorHostSession? session)
                ? Results.Ok(session!.Descriptor)
                : Results.NotFound());
        app.Map("/ws/{id}", async (HttpContext context, string id, SessionStore store) =>
        {
            if (!context.WebSockets.IsWebSocketRequest || !store.TryGet(id, out BlazorHostSession? session))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            using System.Net.WebSockets.WebSocket socket = await context.WebSockets.AcceptWebSocketAsync();
            await session!.AttachAsync(socket, context.RequestAborted);
        });
        app.MapFallbackToFile("runhost.html");

        await app.StartAsync(cancellationToken);
        IServerAddressesFeature? addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>();
        string address = addresses?.Addresses.FirstOrDefault()
            ?? throw new InvalidOperationException("Kestrel did not publish a listening address.");
        return new BlazorRuntimeServer(app, sessions, address);
    }

    public BlazorHostSession CreateSession(
        string programPath,
        string source,
        bool debug,
        bool stopOnEntry,
        bool usesGraphics)
    {
        var descriptor = new SessionDescriptor
        {
            Id = Guid.NewGuid().ToString("N"),
            ProgramName = Path.GetFileName(programPath),
            Source = source,
            Debug = debug,
            StopOnEntry = stopOnEntry,
            UsesGraphics = usesGraphics,
        };
        var session = new BlazorHostSession(descriptor);
        this.sessions.Add(session);
        return session;
    }

    public string GetSessionUrl(BlazorHostSession session)
        => $"{this.BaseAddress}/runhost.html?session={Uri.EscapeDataString(session.Descriptor.Id)}";

    public async ValueTask DisposeAsync() => await this.app.DisposeAsync();
}
