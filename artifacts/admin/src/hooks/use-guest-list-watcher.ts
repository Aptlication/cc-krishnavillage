import { useEffect, useRef } from "react";
import { useGetGuests, getGetGuestsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export function useGuestListWatcher() {
  const { session } = useAuth();
  const previousGuestsRef = useRef<{ id: number; name: string; roomNumber: string }[] | null>(null);
  const isFirstLoadRef = useRef(true);

  const { data: guests } = useGetGuests(
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

  useEffect(() => {
    if (!guests) return;

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      previousGuestsRef.current = guests;
      return;
    }

    const prev = previousGuestsRef.current;
    const prevSignature = prev
      ? prev.map((g) => `${g.id}:${g.name}:${g.roomNumber}`).sort().join("|")
      : "";
    const nextSignature = guests
      .map((g) => `${g.id}:${g.name}:${g.roomNumber}`)
      .sort()
      .join("|");

    if (prevSignature !== nextSignature) {
      const prevCount = prev?.length ?? 0;
      const nextCount = guests.length;
      let description: string | undefined;
      if (nextCount > prevCount) {
        const diff = nextCount - prevCount;
        description = `${diff} new guest${diff > 1 ? "s" : ""} checked in.`;
      } else if (nextCount < prevCount) {
        const diff = prevCount - nextCount;
        description = `${diff} guest${diff > 1 ? "s" : ""} removed.`;
      }
      toast("Guest list updated", {
        description,
        duration: 4000,
      });
    }

    previousGuestsRef.current = guests;
  }, [guests]);
}
