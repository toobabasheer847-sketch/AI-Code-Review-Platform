import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Github,
  Linkedin,
  Loader2,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useMe } from '@/features/auth/hooks/useAuth';
import { AutomationShell } from '@/features/automation/components/AutomationShell';
import { githubApi } from '@/features/github/api/githubApi';
import { socialApi } from '@/features/social/api/socialApi';

import { integrationApi, type IntegrationProvider } from '../api/integrationApi';

const statusCopy: Record<IntegrationProvider['connectionStatus'], string> = {
  connected: 'Connected',
  not_connected: 'Not connected',
  setup_required: 'Setup required',
  reconnect_required: 'Reconnect required',
};

function formatCheckedAt(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value)
      )
    : 'Not checked yet';
}

export const IntegrationsPage = (): JSX.Element => {
  const queryClient = useQueryClient();
  const { data: user } = useMe();
  const [disconnectNotice, setDisconnectNotice] = useState('');
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationApi.list,
    staleTime: 30_000,
  });
  const connect = useMutation({
    mutationFn: (provider: IntegrationProvider['id']) =>
      provider === 'github'
        ? githubApi.connect().then((response) => response.url)
        : socialApi.connectLinkedIn(),
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });

  const check = useMutation({
    mutationFn: ({
      provider,
      accountId,
    }: {
      provider: IntegrationProvider['id'];
      accountId?: string;
    }) => integrationApi.check(provider, accountId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
  const disconnectGitHub = useMutation({
    mutationFn: githubApi.disconnect,
    onSuccess: async (result) => {
      setDisconnectNotice(
        result.providerRevoked
          ? 'GitHub access was revoked by the provider and the local credential was removed.'
          : 'The local GitHub credential was removed. GitHub did not confirm remote revocation; revoke the app from GitHub settings if needed.'
      );
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
  const disconnectLinkedIn = useMutation({
    mutationFn: socialApi.disconnect,
    onSuccess: async () => {
      setDisconnectNotice(
        'The LinkedIn credential was removed locally and pending posts were canceled. Review LinkedIn app permissions to revoke access with the provider.'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['social', 'status'] }),
      ]);
    },
  });
  const providers = integrations.data ?? [];

  return (
    <AutomationShell
      title="Integrations"
      description="Manage provider authorization and inspect the actions available to approved workflows."
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={0}
    >
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
            Workspace / integrations
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Integration management</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Credentials stay on the server. A connection is reported only after provider identity
            and authorization are verified.
          </p>
        </header>
        {integrations.isLoading && <p className="text-sm text-slate-400">Loading integrations…</p>}
        {integrations.isError && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"
          >
            Integration status could not be loaded. Refresh this page to try again.
          </p>
        )}
        {connect.isError && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"
          >
            The provider could not start authorization. Check its backend configuration and try
            again.
          </p>
        )}
        {check.isError && (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"
          >
            The provider could not verify the connection. Check authorization and reconnect if
            needed.
          </p>
        )}
        {disconnectGitHub.isError || disconnectLinkedIn.isError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"
          >
            The integration could not be disconnected. Try again.
          </p>
        ) : null}
        {disconnectNotice && (
          <p
            role="status"
            className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm text-emerald-100"
          >
            {disconnectNotice}
          </p>
        )}

        <div className="space-y-5">
          {providers.map((provider) => {
            const Icon = provider.id === 'github' ? Github : Linkedin;
            const isConnected = provider.connectionStatus === 'connected';
            const pending =
              check.isPending || disconnectGitHub.isPending || disconnectLinkedIn.isPending;
            return (
              <section
                key={provider.id}
                className="space-y-5 rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-7"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <span className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-indigo-200">
                      <Icon aria-hidden="true" className="h-6 w-6" />
                    </span>
                    <div>
                      <h2 className="text-xl font-semibold text-white">{provider.name}</h2>
                      <p className="mt-1 max-w-2xl text-sm text-slate-400">{provider.summary}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${isConnected ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}
                        >
                          {isConnected ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5" />
                          )}
                          {statusCopy[provider.connectionStatus]}
                        </span>
                        <span className="text-slate-500">
                          Authorization: {provider.authorizationStatus.replace('_', ' ')}
                        </span>
                        {!provider.configured && (
                          <span className="text-amber-200">Backend configuration missing</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isConnected &&
                      provider.accounts.map((account) => (
                        <button
                          key={account.id}
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            check.mutate({
                              provider: provider.id,
                              accountId: provider.id === 'linkedin' ? account.id : undefined,
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.05] disabled:opacity-50"
                        >
                          {check.isPending && check.variables?.accountId === account.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Check {account.displayName}
                        </button>
                      ))}
                    {provider.configured && !isConnected && (
                      <button
                        type="button"
                        disabled={connect.isPending}
                        onClick={() => connect.mutate(provider.id)}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                      >
                        {connect.isPending ? 'Starting…' : 'Connect / reconnect'}{' '}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {provider.accounts.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {provider.accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-4"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-100">
                            {account.displayName}
                          </p>
                          {account.scopes && (
                            <p className="mt-1 text-xs text-slate-500">
                              Granted: {account.scopes.join(', ') || 'No permissions recorded'}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-slate-500">
                            Last successful check:{' '}
                            {formatCheckedAt(account.lastSuccessfulConnectionCheckAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Disconnect ${account.displayName}`}
                          disabled={pending}
                          onClick={() =>
                            provider.id === 'github'
                              ? disconnectGitHub.mutate()
                              : disconnectLinkedIn.mutate(account.id)
                          }
                          className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-red-200 disabled:opacity-50"
                        >
                          <Unplug className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">Required permissions</h3>
                    <ul className="mt-2 space-y-1 text-sm text-slate-400">
                      {provider.requiredPermissions.map((permission) => (
                        <li key={permission}>• {permission}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">Setup and reconnection</h3>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-slate-400">
                      {provider.setupInstructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Available actions</h3>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {provider.actions.map((action) => (
                      <article
                        key={action.id}
                        className="rounded-xl border border-white/[0.06] bg-black/20 p-4"
                      >
                        <h4 className="text-sm font-medium text-white">{action.name}</h4>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          {action.description}
                        </p>
                        <p className="mt-3 text-xs text-slate-400">
                          <span className="text-slate-200">Permissions:</span>{' '}
                          {action.permissions.join(', ')}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          <span className="text-slate-200">Retry:</span> {action.retryBehavior}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          <span className="text-slate-200">Approval:</span>{' '}
                          {action.approvalRequired ? 'Required' : 'Not required'}
                        </p>
                        <details className="mt-2 text-xs text-slate-500">
                          <summary className="cursor-pointer">Input schema</summary>
                          <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2">
                            {JSON.stringify(action.inputSchema, null, 2)}
                          </pre>
                        </details>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.04] p-4">
                  <h3 className="text-sm font-semibold text-amber-100">Limitations</h3>
                  <ul className="mt-2 space-y-1 text-sm text-slate-400">
                    {provider.limitations.map((limitation) => (
                      <li key={limitation}>• {limitation}</li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
        <p className="text-sm text-slate-500">
          External write actions remain approval-gated. See the{' '}
          <Link className="text-indigo-300 hover:text-indigo-200" to="/automations">
            workflow command center
          </Link>{' '}
          for GitHub actions and the{' '}
          <Link className="text-indigo-300 hover:text-indigo-200" to="/social">
            LinkedIn approval inbox
          </Link>{' '}
          for posts.
        </p>
      </div>
    </AutomationShell>
  );
};
