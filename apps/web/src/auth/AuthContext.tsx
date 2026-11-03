import { Center, Loader } from "@mantine/core";
import type { AuthMe } from "@quotan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "@/api/client";

async function clearApiCache(): Promise<void> {
	if (typeof caches === "undefined") return;
	try {
		await caches.delete("quotan-api");
	} catch {
		// Cache cleanup is best-effort.
	}
}

interface AuthContextValue {
	auth: AuthMe | undefined;
	isLoading: boolean;
	login: (password: string) => Promise<void>;
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [sessionFlag, setSessionFlag] = useState(0);
	const authQuery = useQuery({
		queryKey: ["auth", sessionFlag],
		queryFn: api.me,
		retry: false,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	});

	const loginMutation = useMutation({
		mutationFn: (password: string) => api.login({ password }),
		onSuccess: (data) => {
			queryClient.setQueryData(["auth", sessionFlag], data);
			void queryClient.invalidateQueries();
		},
	});

	const logoutMutation = useMutation({
		mutationFn: api.logout,
		onSettled: () => {
			void clearApiCache();
			queryClient.clear();
			setSessionFlag((value) => value + 1);
		},
	});

	useEffect(() => {
		const onUnauthorized = () => {
			void clearApiCache();
			queryClient.setQueryData<AuthMe>(["auth", sessionFlag], { authenticated: false });
		};
		window.addEventListener("quotan:unauthorized", onUnauthorized);
		return () => window.removeEventListener("quotan:unauthorized", onUnauthorized);
	}, [queryClient, sessionFlag]);

	const login = useCallback(
		async (password: string) => {
			await loginMutation.mutateAsync(password);
		},
		[loginMutation],
	);
	const logout = useCallback(async () => {
		await logoutMutation.mutateAsync();
	}, [logoutMutation]);

	const value = useMemo<AuthContextValue>(
		() => ({
			auth: authQuery.data,
			isLoading: authQuery.isLoading,
			login,
			logout,
		}),
		[authQuery.data, authQuery.isLoading, login, logout],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) throw new Error("useAuth must be used inside AuthProvider");
	return context;
}

export function RequireAuth() {
	const { auth, isLoading } = useAuth();
	const location = useLocation();

	if (isLoading) {
		return (
			<Center h="100dvh">
				<Loader />
			</Center>
		);
	}
	if (!auth?.authenticated) {
		return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
	}
	return <Outlet />;
}
