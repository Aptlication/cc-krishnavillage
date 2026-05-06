import { useState, useMemo, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetGuests, getGetGuestsQueryKey, useStaffDeleteGuest } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Send, Clock, DoorOpen, Users, RefreshCw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

export default function Guests() {
  const { session } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [guestToRemove, setGuestToRemove] = useState<{ id: number; name: string; roomNumber: string } | null>(null);

  const queryClient = useQueryClient();

  const { data: guests, isLoading, refetch, dataUpdatedAt } = useGetGuests(
    {},
    {
      query: {
        enabled: !!session?.token,
        queryKey: getGetGuestsQueryKey(),
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
      },
    }
  );

  const { mutate: removeGuest, isPending: isRemoving } = useStaffDeleteGuest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGuestsQueryKey() });
        setGuestToRemove(null);
      },
    },
  });

  useEffect(() => {
    if (dataUpdatedAt) {
      setLastRefreshed(new Date(dataUpdatedAt));
    }
  }, [dataUpdatedAt]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);

  const filteredGuests = useMemo(() => {
    if (!guests) return [];
    if (!search.trim()) return guests;
    const lowerSearch = search.toLowerCase();
    return guests.filter(
      (g) =>
        g.name.toLowerCase().includes(lowerSearch) ||
        g.roomNumber.toLowerCase().includes(lowerSearch)
    );
  }, [guests, search]);

  const handleNotifyGuest = (roomNumber: string) => {
    setLocation(`/notifications?room=${encodeURIComponent(roomNumber)}`);
  };

  const handleConfirmRemove = () => {
    if (!guestToRemove) return;
    removeGuest({ id: guestToRemove.id });
  };

  return (
    <Layout>
      <div className="space-y-6 h-full flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-2xl font-serif font-bold text-foreground">Registered Guests</h2>
            <p className="text-muted-foreground">Overview of all active room registrations.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or room..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-guests"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              data-testid="button-refresh-guests"
              className="shrink-0"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
            <div className="p-3 bg-primary/10 text-primary rounded-lg">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Guests</p>
              <p className="text-2xl font-semibold">{guests?.length || 0}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col">
          {lastRefreshed && (
            <div className="px-6 py-2 border-b border-border bg-muted/30 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Last updated {format(lastRefreshed, "h:mm:ss a")} — refreshes every 30 seconds
            </div>
          )}
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 uppercase sticky top-0 backdrop-blur-sm z-10">
                <tr>
                  <th className="px-6 py-4 font-medium">Surname</th>
                  <th className="px-6 py-4 font-medium">Room</th>
                  <th className="px-6 py-4 font-medium">Registered</th>
                  <th className="px-6 py-4 font-medium">Last Changed</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-32"></div></td>
                      <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16"></div></td>
                      <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                      <td className="px-6 py-4 text-right"><div className="h-8 bg-muted rounded w-24 ml-auto"></div></td>
                    </tr>
                  ))
                ) : filteredGuests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      No guests found.
                    </td>
                  </tr>
                ) : (
                  filteredGuests.map((guest) => {
                    const wasUpdated = guest.updatedAt !== guest.createdAt;
                    return (
                    <tr
                      key={guest.id}
                      className="hover:bg-accent/50 transition-colors group"
                      data-testid={`row-guest-${guest.id}`}
                    >
                      <td className="px-6 py-4 font-medium text-foreground">{guest.name}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <DoorOpen className="w-4 h-4 text-muted-foreground" />
                          <span className="font-mono">{guest.roomNumber}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4" />
                          {format(new Date(guest.createdAt), "MMM d, h:mm a")}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {wasUpdated ? (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-amber-500" />
                            <span className="text-amber-600 dark:text-amber-400">
                              {format(new Date(guest.updatedAt), "MMM d, h:mm a")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="opacity-60 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleNotifyGuest(guest.roomNumber)}
                            data-testid={`button-notify-${guest.id}`}
                          >
                            <Send className="w-4 h-4 mr-2" />
                            Notify
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="opacity-60 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:border-destructive/50"
                            onClick={() => setGuestToRemove({ id: guest.id, name: guest.name, roomNumber: guest.roomNumber })}
                            data-testid={`button-remove-${guest.id}`}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AlertDialog open={!!guestToRemove} onOpenChange={(open) => { if (!open) setGuestToRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Guest</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{guestToRemove?.name}</strong> (Room {guestToRemove?.roomNumber}) from the guest list? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-remove"
            >
              {isRemoving ? "Removing..." : "Remove Guest"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
