import { axiosInstance } from '@/lib/axios';
export const githubApi = {
    disconnect: async () => {
        const response = await axiosInstance.delete('/github/disconnect');
        return response.data;
    },
    connect: async () => {
        const response = await axiosInstance.get('/github/connect');
        return response.data;
    },
    getRepos: async () => {
        const response = await axiosInstance.get('/github/repos');
        return response.data;
    },
    getRepoFiles: async (repoFullName) => {
        const response = await axiosInstance.get(`/github/repos/${encodeURIComponent(repoFullName)}/files`);
        return response.data;
    },
    getFileContent: async (repo, path) => {
        const response = await axiosInstance.get('/github/file', {
            params: {
                repo,
                path,
            },
        });
        return response.data;
    },
};
