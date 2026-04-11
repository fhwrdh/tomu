import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { auth, setToken, getToken } from "../services/api.js";

const DEV_EMAIL = "stout@tomu.dev";
const DEV_PASSWORD = "tomu1234";

export function useAuth() {
  const queryClient = useQueryClient();
  const autoLoginAttempted = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => auth.me(),
    enabled: !!getToken(),
    retry: false,
  });

  // Auto-login in development
  useEffect(() => {
    if (autoLoginAttempted.current || getToken() || data?.user) return;
    autoLoginAttempted.current = true;
    auth.login(DEV_EMAIL, DEV_PASSWORD).then((res) => {
      setToken(res.token);
      queryClient.setQueryData(["auth", "me"], { user: res.user });
    }).catch(() => {
      // Dev user doesn't exist yet, ignore
    });
  }, [data, queryClient]);

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
