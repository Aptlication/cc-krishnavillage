import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSendNotification, useGetNotifications, getGetNotificationsQueryKey, useGetGuests, getGetGuestsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Send, History, CheckCircle2, Megaphone, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";

type NotificationType = "general" | "room_ready" | "activity" | "checkout_reminder";

export default function Notifications() {
  const { session, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const search = useSearch();
  const prefilledRoom = new URLSearchParams(search).get("room") ?? "all";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<NotificationType>("general");
  const [targetRoom, setTargetRoom] = useState(prefilledRoom);

  useEffect(() => {
    setTargetRoom(prefilledRoom);
  }, [prefilledRoom]);

  const { data: guests } = useGetGuests(
    {},
    {
      query: {
        queryKey: getGetGuestsQueryKey({}),
        enabled: !!session?.token,
        retry: false,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
      },
    }
  );

  const registeredRooms = Array.from(
    new Set((guests ?? []).map((g) => g.roomNumber).filter(Boolean))
  ).sort();

  const guestsByRoom = (guests ?? []).reduce<Record<string, string[]>>((acc, g) => {
    if (!g.roomNumber) return acc;
    if (!acc[g.roomNumber]) acc[g.roomNumber] = [];
    acc[g.roomNumber].push(g.name);
    return acc;
  }, {});

  const roomLabel = (room: string) => {
    const names = guestsByRoom[room];
    if (!names || names.length === 0) return `Room ${room}`;
    if (names.length === 1) return `Room ${room} — ${names[0]}`;
    return `Room ${room} — ${names.length} guests`;
  };

  const sendMutation = useSendNotification();
  const { data: history, isLoading: isHistoryLoading, isError: isHistoryError } = useGetNotifications(
    {},
    {
      query: {
        enabled: !!session?.token,
        queryKey: getGetNotificationsQueryKey(),
        retry: false,
      },
    }
  );

  useEffect(() => {
    if (!session?.staffId) return;
    const key = `notificationsLastViewed_${session.staffId}`;
    localStorage.setItem(key, String(Date.now()));
    return () => {
      localStorage.setItem(key, String(Date.now()));
    };
  }, [session?.staffId]);

  const shownHistoryErrorRef = useRef(false);
  useEffect(() => {
    if (isHistoryError && !shownHistoryErrorRef.current) {
      shownHistoryErrorRef.current = true;
      toast({ title: "Could not load notification history", description: "Check your connection or try refreshing.", variant: "destructive" });
    }
    if (!isHistoryError) {
      shownHistoryErrorRef.current = false;
    }
  }, [isHistoryError, toast]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim() || !targetRoom.trim()) {
      toast({
        title: "Missing fields",
        description: "Please fill in all fields before sending.",
        variant: "destructive"
      });
      return;
    }

    sendMutation.mutate(
      {
        data: {
          title,
          body,
          type,
          targetRoom,
        },
      },
      {
        onSuccess: (result) => {
          toast({
            title: "Notification Sent",
            description: `Delivered to ${result.recipientCount} recipient(s).`,
          });
          setTitle("");
          setBody("");
          queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to send notification. Please check your connection.",
            variant: "destructive"
          });
        }
      }
    );
  };

  const typeLabels = {
    general: "General Update",
    room_ready: "Room Ready",
    activity: "Activity Reminder",
    checkout_reminder: "Checkout Reminder"
  };

  return (
    <Layout>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
        <div className="lg:col-span-5 space-y-6">
          <div>
            <h2 className="text-2xl font-serif font-bold text-foreground">Send Message</h2>
            <p className="text-muted-foreground">Push notifications to guest devices.</p>
          </div>

          <Card className="border-border shadow-sm">
            <CardContent className="pt-6">
              <form onSubmit={handleSend} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="targetRoom">Recipient</Label>
                  <Select value={targetRoom} onValueChange={setTargetRoom}>
                    <SelectTrigger id="targetRoom" data-testid="select-target">
                      <SelectValue placeholder="Select recipient" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <div className="flex items-center gap-2">
                          <Megaphone className="w-4 h-4 text-primary" />
                          <span className="font-medium text-primary">All Guests (Broadcast)</span>
                        </div>
                      </SelectItem>
                      {registeredRooms.length > 0 && (
                        <SelectItem value="__rooms_header" disabled className="text-xs font-semibold text-muted-foreground bg-muted/30">
                          SPECIFIC ROOMS
                        </SelectItem>
                      )}
                      {registeredRooms.map((room) => (
                        <SelectItem key={room} value={room}>
                          {roomLabel(room)}
                        </SelectItem>
                      ))}
                      {targetRoom !== "all" && !registeredRooms.includes(targetRoom) && (
                        <SelectItem value={targetRoom}>{roomLabel(targetRoom)}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {targetRoom !== "all" && (
                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                      <span>Currently targeting Room {targetRoom}</span>
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setTargetRoom("all")}>
                        Clear
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Message Type</Label>
                  <Select value={type} onValueChange={(val) => setType(val as NotificationType)}>
                    <SelectTrigger id="type" data-testid="select-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General Update</SelectItem>
                      <SelectItem value="room_ready">Room Ready</SelectItem>
                      <SelectItem value="activity">Activity Reminder</SelectItem>
                      <SelectItem value="checkout_reminder">Checkout Reminder</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Yoga Session Starting"
                    data-testid="input-title"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="body">Message Body</Label>
                  <Textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Type your message here..."
                    rows={4}
                    className="resize-none"
                    data-testid="input-body"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={sendMutation.isPending}
                  data-testid="button-send"
                >
                  {sendMutation.isPending ? (
                    "Sending..."
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Notification
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7 space-y-6 flex flex-col h-full overflow-hidden">
          <div>
            <h2 className="text-2xl font-serif font-bold text-foreground">History</h2>
            <p className="text-muted-foreground">Previously sent communications.</p>
          </div>

          <Card className="flex-1 border-border shadow-sm overflow-hidden flex flex-col">
            <CardHeader className="py-4 border-b border-border bg-muted/30 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <History className="w-4 h-4" />
                Notification Log
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-auto flex-1">
              <div className="divide-y divide-border">
                {isHistoryLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 animate-pulse space-y-3">
                      <div className="flex justify-between">
                        <div className="h-4 bg-muted rounded w-1/3"></div>
                        <div className="h-4 bg-muted rounded w-16"></div>
                      </div>
                      <div className="h-3 bg-muted rounded w-3/4"></div>
                    </div>
                  ))
                ) : !history || history.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <p>No notifications have been sent yet.</p>
                  </div>
                ) : (
                  [...history].reverse().map((item) => (
                    <div key={item.id} className="p-5 hover:bg-accent/30 transition-colors" data-testid={`history-item-${item.id}`}>
                      <div className="flex justify-between items-start mb-2 gap-4">
                        <div className="space-y-1 min-w-0">
                          <h4 className="font-semibold text-foreground truncate">{item.title}</h4>
                          <p className="text-sm text-muted-foreground truncate">{item.body}</p>
                        </div>
                        <div className="shrink-0 text-right space-y-1">
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(item.sentAt), "MMM d, h:mm a")}
                          </div>
                          <div className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            {item.targetRoom === "all" ? "All Guests" : `Room ${item.targetRoom}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-secondary-foreground"></span>
                          {typeLabels[item.type as keyof typeof typeLabels] || item.type}
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                          Delivered to {item.recipientCount} devices
                        </span>
                        {item.sentByName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-blue-500" />
                            {item.sentByName}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
