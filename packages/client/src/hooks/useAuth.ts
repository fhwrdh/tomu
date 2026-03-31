import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { auth, setToken, getToken } from "../services/api.js";

export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => auth.me(),
    enabled: !!getToken(),
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      auth.login(email, password),
    onSuccess: (data) => {
      setToken(data.token);
      queryClient.setQueryData(["auth", "me"], { user: data.user });
    },
  });

  const registerMutation = useMutation({
    mutationFn: ({ email, password, displayName }: { email: string; password: string; displayName?: string }) =>
      auth.register(email, password, displayName),
    onSuccess: (data) => {
      setToken(data.token);
      queryClient.setQueryData(["auth", "me"], { user: data.user });
    },
  });

  const logout = () => {
    setToken(null);
    queryClient.clear();
  };

  return {
    user: data?.user ?? null,
    isAuthenticated: !!data?.user,
    isLoading: !!getToken() && isLoading,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
    logout,
  };
}
