import { useMutation, useQuery, useQueryClient, } from '@tanstack/react-query';
import { useAppStore } from '@/app/store/useAppStore';
import { githubApi } from '../api/githubApi';
export const githubQueryKeys = {
    repos: ['github', 'repos'],
    repoFiles: (repoFullName) => ['github', 'repos', repoFullName, 'files'],
};
export const useConnectGitHub = () => {
    return useMutation({
        mutationFn: githubApi.connect,
        onSuccess: ({ url }) => {
            window.location.assign(url);
        },
    });
};
export const useGetRepos = () => {
    const githubConnected = useAppStore((state) => state.user?.githubConnected);
    return useQuery({
        queryKey: githubQueryKeys.repos,
        queryFn: githubApi.getRepos,
        enabled: !!githubConnected,
        staleTime: 60 * 1000,
        retry: 1,
    });
};
export const useGetRepoFiles = (repoFullName) => {
    return useQuery({
        queryKey: githubQueryKeys.repoFiles(repoFullName ?? ''),
        queryFn: () => githubApi.getRepoFiles(repoFullName),
        enabled: !!repoFullName,
        staleTime: 60 * 1000,
        retry: 1,
    });
};
export const usePrefetchRepoFiles = () => {
    const queryClient = useQueryClient();
    return (repoFullName) => {
        void queryClient.prefetchQuery({
            queryKey: githubQueryKeys.repoFiles(repoFullName),
            queryFn: () => githubApi.getRepoFiles(repoFullName),
            staleTime: 60 * 1000,
        });
    };
};
