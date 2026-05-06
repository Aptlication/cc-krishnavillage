import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useGuest } from "@/context/GuestContext";
import { NotificationCard, NotificationItem } from "@/components/NotificationCard";
import { AddToHomeScreenBanner } from "@/components/AddToHomeScreenBanner";
import { setBaseUrl } from "@workspace/api-client-react";
import { fetchWithTenant } from "@/lib/fetchWithTenant";
import { playNotificationChime } from "@/lib/sound";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // expo-notifications remote push not available in Expo Go SDK 53+
}

const PREFS_KEY = "@krishna_village_prefs";
const DISMISSED_KEY = "@krishna_village_dismissed";
const UNDO_DURATION = 3000;

const TYPE_PREF_MAP: Record<string, keyof NotificationPrefs> = {
  room_ready: "roomReady",
  activity: "activity",
  checkout_reminder: "checkoutReminder",
  general: "general",
};

interface NotificationPrefs {
  roomReady: boolean;
  activity: boolean;
  checkoutReminder: boolean;
  general: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  roomReady: true,
  activity: true,
  checkoutReminder: true,
  general: true,
};

interface UndoItem {
  id: number;
  title: string;
  timeoutRef: ReturnType<typeof setTimeout>;
  progress: Animated.Value;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { guest, setGuest } = useGuest();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [undoItem, setUndoItem] = useState<UndoItem | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const fetchNotificationsRef = useRef<(showRefresh?: boolean) => void>(() => {});

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editRoomNumber, setEditRoomNumber] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";

  async function loadDismissed(): Promise<Set<number>> {
    try {
      const val = await AsyncStorage.getItem(DISMISSED_KEY);
      if (val) return new Set(JSON.parse(val) as number[]);
    } catch {}
    return new Set();
  }

  async function saveDismissed(ids: Set<number>) {
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
    } catch {}
  }

  async function loadPrefs(): Promise<NotificationPrefs> {
    try {
      const val = await AsyncStorage.getItem(PREFS_KEY);
      if (val) return { ...DEFAULT_PREFS, ...JSON.parse(val) };
    } catch {}
    return DEFAULT_PREFS;
  }

  function filterItems(
    items: NotificationItem[],
    currentPrefs: NotificationPrefs,
    dismissed: Set<number>
  ): NotificationItem[] {
    return items.filter((item) => {
      if (dismissed.has(item.id)) return false;
      const prefKey = TYPE_PREF_MAP[item.type];
      if (!prefKey) return true;
      return currentPrefs[prefKey];
    });
  }

  async function fetchNotifications(showRefresh = false) {
    if (showRefresh) setIsRefreshing(true);
    try {
      const [currentPrefs, dismissed] = await Promise.all([loadPrefs(), loadDismissed()]);
      setPrefs(currentPrefs);
      setDismissedIds(dismissed);

      const url = guest?.roomNumber
        ? `${baseUrl}/api/notifications?roomNumber=${encodeURIComponent(guest.roomNumber)}`
        : `${baseUrl}/api/notifications`;
      const resp = await fetchWithTenant(url);
      if (resp.ok) {
        const data: NotificationItem[] = await resp.json();
        setNotifications(filterItems(data.reverse(), currentPrefs, dismissed));
        setError(null);

        // Play chime when new notifications arrive via polling (skip initial load)
        if (data.length > 0) {
          const maxId = Math.max(...data.map((n) => n.id));
          if (!isInitialFetchRef.current && maxId > lastSeenMaxIdRef.current) {
            playNotificationChime();
          }
          lastSeenMaxIdRef.current = Math.max(lastSeenMaxIdRef.current, maxId);
        }
        isInitialFetchRef.current = false;
      } else {
        setError("Could not load notifications");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  function handleDelete(id: number) {
    const item = notifications.find((n) => n.id === id);
    if (!item) return;

    // Immediately hide from list
    setNotifications((prev) => prev.filter((n) => n.id !== id));

    // Cancel any existing undo item (commit it immediately)
    if (undoItem) {
      clearTimeout(undoItem.timeoutRef);
      commitDismiss(undoItem.id);
    }

    // Start the 3-second undo window
    const progress = new Animated.Value(1);
    Animated.timing(progress, {
      toValue: 0,
      duration: UNDO_DURATION,
      useNativeDriver: false,
    }).start();

    const timeoutRef = setTimeout(() => {
      commitDismiss(id);
      setUndoItem(null);
    }, UNDO_DURATION);

    setUndoItem({ id, title: item.title, timeoutRef, progress });
  }

  function handleUndo() {
    if (!undoItem) return;
    clearTimeout(undoItem.timeoutRef);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Restore the notification back into the list
    setNotifications((prev) => {
      // Find the original notification from the full server data isn't possible here,
      // so we need to keep a reference. Instead, refetch to restore accurately.
      return prev;
    });
    setUndoItem(null);

    // Refetch to restore the item
    fetchNotifications();
  }

  function openEditModal() {
    setEditName(guest?.name ?? "");
    setEditRoomNumber(guest?.roomNumber ?? "");
    setEditError(null);
    setEditModalVisible(true);
  }

  async function handleSaveProfile() {
    if (!editName.trim()) {
      setEditError("Please enter your name");
      return;
    }
    if (!editRoomNumber.trim()) {
      setEditError("Please enter your room number");
      return;
    }
    if (!guest?.id) {
      setEditError("Unable to update profile — please re-register to enable editing");
      return;
    }

    setEditLoading(true);
    setEditError(null);

    try {
      const response = await fetchWithTenant(`${baseUrl}/api/guests/${guest.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToken: guest.pushToken,
          name: editName.trim(),
          roomNumber: editRoomNumber.trim().toUpperCase(),
        }),
      });

      if (!response.ok) throw new Error("Update failed");

      setGuest({
        ...guest,
        name: editName.trim(),
        roomNumber: editRoomNumber.trim().toUpperCase(),
      });

      setEditModalVisible(false);
      fetchNotifications();
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {};
    } catch {
      setEditError("Could not update profile. Please try again.");
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    } finally {
      setEditLoading(false);
    }
  }

  async function commitDismiss(id: number) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }

  // Track highest notification ID seen so we can detect new ones on each poll
  const lastSeenMaxIdRef = useRef<number>(-1);
  const isInitialFetchRef = useRef(true);

  // Always keep the ref pointing at the latest fetchNotifications so the interval
  // never captures a stale closure (guest was null at mount time).
  fetchNotificationsRef.current = fetchNotifications;

  useEffect(() => {
    fetchNotificationsRef.current();

    if (Platform.OS !== "web") {
      try {
        notificationListener.current = Notifications.addNotificationReceivedListener(() => {
          fetchNotificationsRef.current();
          playNotificationChime();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        });
      } catch {
        // expo-notifications remote push not available in Expo Go SDK 53+
      }
    }

    const interval = setInterval(() => fetchNotificationsRef.current(), 30000);

    return () => {
      notificationListener.current?.remove();
      clearInterval(interval);
    };
  }, []);

  // When guest roomNumber becomes available after AsyncStorage loads, re-fetch
  // with the correct roomNumber so the initial render isn't stale.
  const prevRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const room = guest?.roomNumber;
    if (room && room !== prevRoomRef.current) {
      prevRoomRef.current = room;
      fetchNotificationsRef.current();
    }
  }, [guest?.roomNumber]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (undoItem) clearTimeout(undoItem.timeoutRef);
    };
  }, [undoItem]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const allDisabled = !prefs.roomReady && !prefs.activity && !prefs.checkoutReminder && !prefs.general;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        {/* Brand row */}
        <View style={styles.brandRow}>
          <Image
            source={require("@/assets/kv-icon.png")}
            style={styles.brandLogo}
          />
          <View>
            <Text style={styles.brandName}>Krishna Village</Text>
            <Text style={styles.brandSub}>Eco Yoga Community</Text>
          </View>
        </View>
        {/* Title + actions row */}
        <View style={styles.titleRow}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
            {guest && (
              <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
                Room {guest.roomNumber} · {guest.name}
              </Text>
            )}
          </View>
          <View style={styles.headerActions}>
            {guest && (
              <Pressable
                onPress={openEditModal}
                style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
                testID="edit-profile-button"
              >
                {Platform.OS === "web" ? (
                  <Text style={{ fontSize: 17, color: colors.primary }}>✏️</Text>
                ) : (
                  <Feather name="edit-2" size={18} color={colors.primary} />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => router.replace("/register")}
              style={[styles.backBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              testID="back-button"
            >
              <Text style={[styles.backBtnText, { color: colors.primary }]}>Home</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {allDisabled && (
        <View style={[styles.banner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {Platform.OS === "web" ? (
            <Text style={{ fontSize: 14 }}>🔕</Text>
          ) : (
            <Feather name="bell-off" size={14} color={colors.mutedForeground} />
          )}
          <Text style={[styles.bannerText, { color: colors.mutedForeground }]}>
            All notification types are disabled in Settings.
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          {Platform.OS === "web" ? (
            <Text style={{ fontSize: 36 }}>📶</Text>
          ) : (
            <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          )}
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error}</Text>
          <Pressable
            onPress={() => fetchNotifications()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <NotificationCard
              notification={item}
              onDelete={handleDelete}
            />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 120 }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchNotifications(true)}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<AddToHomeScreenBanner />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
                {Platform.OS === "web" ? (
                  <Text style={{ fontSize: 32 }}>🔔</Text>
                ) : (
                  <Feather name="bell" size={32} color={colors.mutedForeground} />
                )}
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No notifications yet
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                When staff send updates about your room or activities, they will appear here.
              </Text>
            </View>
          }
          scrollEnabled={!!notifications.length}
        />
      )}

      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setEditModalVisible(false)} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Profile</Text>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
                hitSlop={8}
              >
                {Platform.OS === "web" ? (
                  <Text style={{ fontSize: 18, color: colors.mutedForeground, lineHeight: 20 }}>✕</Text>
                ) : (
                  <Feather name="x" size={18} color={colors.mutedForeground} />
                )}
              </Pressable>
            </View>

            <View style={styles.modalFields}>
              <View style={styles.modalFieldGroup}>
                <Text style={[styles.modalLabel, { color: colors.foreground }]}>Your Name</Text>
                <View style={[styles.inputWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                  {Platform.OS === "web" ? (
                    <Text style={[{ fontSize: 16 }, styles.inputIcon]}>👤</Text>
                  ) : (
                    <Feather name="user" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
                  )}
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="e.g. Priya Sharma"
                    placeholderTextColor={colors.mutedForeground}
                    value={editName}
                    onChangeText={setEditName}
                    autoCapitalize="words"
                    returnKeyType="next"
                    testID="edit-name-input"
                  />
                </View>
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={[styles.modalLabel, { color: colors.foreground }]}>Room Number</Text>
                <View style={[styles.inputWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                  {Platform.OS === "web" ? (
                    <Text style={[{ fontSize: 16 }, styles.inputIcon]}>🏠</Text>
                  ) : (
                    <Feather name="home" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
                  )}
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="e.g. 12 or B4"
                    placeholderTextColor={colors.mutedForeground}
                    value={editRoomNumber}
                    onChangeText={setEditRoomNumber}
                    autoCapitalize="characters"
                    returnKeyType="done"
                    onSubmitEditing={handleSaveProfile}
                    testID="edit-room-input"
                  />
                </View>
              </View>

              {editError && (
                <Text style={[styles.modalError, { color: colors.destructive }]}>{editError}</Text>
              )}

              <Pressable
                onPress={handleSaveProfile}
                disabled={editLoading}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: colors.primary, opacity: pressed || editLoading ? 0.8 : 1 },
                ]}
                testID="save-profile-button"
              >
                {editLoading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    {Platform.OS === "web" ? (
                      <Text style={{ fontSize: 18, color: colors.primaryForeground }}>✓</Text>
                    ) : (
                      <Feather name="check" size={18} color={colors.primaryForeground} />
                    )}
                    <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                      Save Changes
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {undoItem && (
        <View
          style={[
            styles.undoContainer,
            { bottom: bottomPad + 90, backgroundColor: colors.foreground },
          ]}
        >
          <View style={styles.undoContent}>
            <Text style={[styles.undoText, { color: colors.background }]} numberOfLines={1}>
              Deleted "{undoItem.title}"
            </Text>
            <Pressable onPress={handleUndo} style={styles.undoBtn} hitSlop={8}>
              <Text style={[styles.undoBtnText, { color: colors.primary }]}>Undo</Text>
            </Pressable>
          </View>
          <Animated.View
            style={[
              styles.undoProgress,
              {
                backgroundColor: colors.primary,
                width: undoItem.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "column",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 10,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  brandName: {
    fontSize: 17,
    fontFamily: "PlayfairDisplay_400Regular",
    letterSpacing: 0.3,
    lineHeight: 20,
    color: '#1a5276',
  },
  brandSub: {
    fontSize: 12,
    fontFamily: "CormorantSC_300Light",
    letterSpacing: 0.12 * 12,
    lineHeight: 16,
    color: '#2e86c1',
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerLeft: { flex: 1, gap: 2 },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 2,
  },
  backBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 1,
  },
  backBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.1,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  undoContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  undoContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  undoText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  undoBtn: {
    paddingHorizontal: 4,
  },
  undoBtnText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  undoProgress: {
    height: 3,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 20,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    alignSelf: "center",
    marginTop: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  modalFields: {
    gap: 14,
  },
  modalFieldGroup: {
    gap: 6,
  },
  modalLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  inputIcon: {},
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  modalError: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 14,
    gap: 10,
    marginTop: 4,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
