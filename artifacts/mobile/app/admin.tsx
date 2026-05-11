import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { playSuccessChime, playNotificationChime } from "@/lib/sound";

type NotificationType = "room_ready" | "activity" | "checkout_reminder" | "general";
type Resolution = "actioned" | "delegated";

interface MaintenanceReport {
  id: number;
  guestName: string;
  roomNumber: string;
  title: string;
  description: string;
  urgency: "urgent" | "non_urgent";
  status: string;
  resolution: "actioned" | "delegated" | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  resolutionNoteEditedByName: string | null;
  resolutionNoteEditedAt: string | null;
  photos: string[] | null;
  createdAt: string;
  resolvedAt: string | null;
}

const NOTIFICATION_TYPES: {
  value: NotificationType;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  description: string;
}[] = [
  { value: "room_ready", label: "Room Ready", icon: "check-circle", description: "Room has been cleaned" },
  { value: "activity", label: "Activity", icon: "calendar", description: "Event or program announcement" },
  { value: "checkout_reminder", label: "Check-out", icon: "clock", description: "Check-out time reminder" },
  { value: "general", label: "General", icon: "bell", description: "General information" },
];

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString();
}

export default function AdminScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authToken, setAuthToken] = useState("");

  const [selectedType, setSelectedType] = useState<NotificationType>("room_ready");
  const [targetRoom, setTargetRoom] = useState("");
  const [sendToAll, setSendToAll] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [resolvedReports, setResolvedReports] = useState<MaintenanceReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsRefreshing, setReportsRefreshing] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyDateFilter, setHistoryDateFilter] = useState<"today" | "week" | "all">("all");
  const [historyResolutionFilter, setHistoryResolutionFilter] = useState<"all" | "actioned" | "delegated">("all");
  const [historySearchQuery, setHistorySearchQuery] = useState("");

  const [signOffReport, setSignOffReport] = useState<MaintenanceReport | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<Resolution | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";

  const fetchReports = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setReportsRefreshing(true);
      else setReportsLoading(true);
      try {
        const resp = await fetch(`${baseUrl}/api/maintenance`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (resp.ok) {
          const data: MaintenanceReport[] = await resp.json();
          setReports(data.filter((r) => r.status === "open"));
          setResolvedReports(data.filter((r) => r.status === "resolved"));
        }
      } catch {
        // silently fail — staff can pull to refresh
      } finally {
        setReportsLoading(false);
        setReportsRefreshing(false);
      }
    },
    [authToken, baseUrl],
  );

  useEffect(() => {
    if (isAuthenticated && authToken) {
      fetchReports();
    }
  }, [isAuthenticated, authToken, fetchReports]);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) return;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const resp = await fetch(`${baseUrl}/api/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (resp.ok) {
        const data = await resp.json() as { token: string };
        setAuthToken(data.token);
        setIsAuthenticated(true);
        setPassword("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const err = await resp.json() as { error?: string };
        setLoginError(err.error ?? "Invalid credentials");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      setLoginError("Could not connect to server");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoggingIn(false);
    }
  }

  function getDefaultMessage(type: NotificationType, room: string): { title: string; body: string } {
    const roomStr = room ? `Room ${room}` : "your room";
    switch (type) {
      case "room_ready":
        return { title: "Your room is ready", body: `${roomStr} has been freshly cleaned and is ready for you.` };
      case "activity":
        return { title: "Activity announcement", body: "A new activity or program is starting soon. Join us!" };
      case "checkout_reminder":
        return { title: "Check-out reminder", body: "Please remember to check out by 10am. We hope you enjoyed your stay!" };
      case "general":
        return { title: "Message from Krishna Village", body: "Thank you for staying with us." };
    }
  }

  async function handleSend() {
    const target = sendToAll ? "all" : targetRoom.trim().toUpperCase();
    if (!sendToAll && !target) {
      setSendResult({ success: false, message: "Please enter a room number or select all guests" });
      return;
    }
    const defaults = getDefaultMessage(selectedType, target);
    const title = customTitle.trim() || defaults.title;
    const body = customBody.trim() || defaults.body;

    setIsSending(true);
    setSendResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const resp = await fetch(`${baseUrl}/api/notifications/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ title, body, type: selectedType, targetRoom: target }),
      });

      if (resp.ok) {
        const data = await resp.json();
        setSendResult({ success: true, message: `Sent to ${data.recipientCount} device${data.recipientCount !== 1 ? "s" : ""}` });
        setCustomTitle("");
        setCustomBody("");
        setTargetRoom("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        playSuccessChime();
      } else if (resp.status === 401) {
        setIsAuthenticated(false);
        setAuthToken("");
        setSendResult({ success: false, message: "Session expired. Please log in again." });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        setSendResult({ success: false, message: "Failed to send notification" });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      setSendResult({ success: false, message: "Could not connect to server" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSending(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const resp = await fetch(`${baseUrl}/api/maintenance/export`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!resp.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const csvText = await resp.text();
      const filename = `maintenance-history-${new Date().toISOString().slice(0, 10)}.csv`;
      const fileUri = (FileSystem.cacheDirectory ?? "") + filename;
      await FileSystem.writeAsStringAsync(fileUri, csvText, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Export Maintenance History",
          UTI: "public.comma-separated-values-text",
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsExporting(false);
    }
  }

  function openSignOff(report: MaintenanceReport) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSignOffReport(report);
    setSelectedResolution(null);
  }

  function closeSignOff() {
    setSignOffReport(null);
    setSelectedResolution(null);
    setResolutionNote("");
    setIsResolving(false);
  }

  async function handleConfirmResolve() {
    if (!signOffReport || !selectedResolution) return;
    setIsResolving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const resp = await fetch(`${baseUrl}/api/maintenance/${signOffReport.id}/resolve`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ resolution: selectedResolution, resolutionNote: resolutionNote.trim() || undefined }),
      });

      if (resp.ok) {
        const resolved: Pick<MaintenanceReport, "resolution" | "resolvedAt" | "resolvedByName" | "resolutionNote"> = await resp.json();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setReports((prev) => prev.filter((r) => r.id !== signOffReport.id));
        setResolvedReports((prev) => [
          {
            ...signOffReport,
            status: "resolved",
            resolution: resolved.resolution ?? selectedResolution,
            resolvedAt: resolved.resolvedAt ?? new Date().toISOString(),
            resolvedByName: resolved.resolvedByName ?? null,
            resolutionNote: resolved.resolutionNote ?? null,
          },
          ...prev,
        ]);
        closeSignOff();
      } else if (resp.status === 401) {
        setIsAuthenticated(false);
        setAuthToken("");
        closeSignOff();
      }
    } catch {
      // keep modal open so staff can retry
    } finally {
      setIsResolving(false);
    }
  }

  const urgentReports = reports.filter((r) => r.urgency === "urgent");
  const nonUrgentReports = reports.filter((r) => r.urgency === "non_urgent");

  const filteredResolvedReports = useMemo(() => {
    const q = historySearchQuery.trim().toLowerCase();
    return resolvedReports.filter((report) => {
      if (historyResolutionFilter !== "all" && report.resolution !== historyResolutionFilter) {
        return false;
      }
      if (historyDateFilter !== "all") {
        const resolved = report.resolvedAt ? new Date(report.resolvedAt) : new Date(report.createdAt);
        const now = new Date();
        if (historyDateFilter === "today") {
          if (resolved.toDateString() !== now.toDateString()) return false;
        } else if (historyDateFilter === "week") {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (resolved < weekAgo) return false;
        }
      }
      if (q) {
        const matchesGuest = report.guestName.toLowerCase().includes(q);
        const matchesRoom = report.roomNumber.toLowerCase().includes(q);
        const matchesTitle = report.title.toLowerCase().includes(q);
        if (!matchesGuest && !matchesRoom && !matchesTitle) return false;
      }
      return true;
    });
  }, [resolvedReports, historyDateFilter, historyResolutionFilter, historySearchQuery]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  if (!isAuthenticated) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.pinContainer, { paddingTop: topPad }]}>
            <View style={[styles.lockIcon, { backgroundColor: colors.muted }]}>
              <Feather name="lock" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.pinTitle, { color: colors.foreground }]}>Staff Access</Text>
            <Text style={[styles.pinSubtitle, { color: colors.mutedForeground }]}>
              Sign in with your staff username and password
            </Text>

            <View
              style={[
                styles.pinInputWrapper,
                { borderColor: loginError ? colors.destructive : colors.input, backgroundColor: colors.muted, marginBottom: 8 },
              ]}
            >
              <Feather name="user" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.pinInput, { color: colors.foreground }]}
                placeholder="Username"
                placeholderTextColor={colors.mutedForeground}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                testID="username-input"
              />
            </View>

            <View
              style={[
                styles.pinInputWrapper,
                { borderColor: loginError ? colors.destructive : colors.input, backgroundColor: colors.muted },
              ]}
            >
              <Feather name="lock" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.pinInput, { color: colors.foreground }]}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                testID="password-input"
              />
            </View>

            {loginError && <Text style={[styles.pinError, { color: colors.destructive }]}>{loginError}</Text>}

            <Pressable
              onPress={handleLogin}
              disabled={isLoggingIn}
              style={({ pressed }) => [styles.pinButton, { backgroundColor: colors.primary, opacity: pressed || isLoggingIn ? 0.8 : 1 }]}
              testID="login-submit"
            >
              {isLoggingIn
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <Text style={[styles.pinButtonText, { color: colors.primaryForeground }]}>Sign In</Text>
              }
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={reportsRefreshing}
              onRefresh={() => fetchReports(true)}
              tintColor={colors.primary}
            />
          }
        >
          {/* ── Header ── */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Staff Panel</Text>
            <Pressable
              onPress={() => {
                setIsAuthenticated(false);
                setAuthToken("");
                setReports([]);
                setResolvedReports([]);
              }}
              hitSlop={12}
            >
              <Feather name="log-out" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* ── Send Notification ── */}
          <Text style={[styles.subHeading, { color: colors.foreground }]}>Send Notification</Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Notification Type</Text>
            <View style={styles.typeGrid}>
              {NOTIFICATION_TYPES.map((type) => {
                const isSelected = selectedType === type.value;
                return (
                  <Pressable
                    key={type.value}
                    onPress={() => {
                      setSelectedType(type.value);
                      Haptics.selectionAsync();
                    }}
                    style={[
                      styles.typeBtn,
                      {
                        backgroundColor: isSelected ? colors.primary + "15" : colors.muted,
                        borderColor: isSelected ? colors.primary : "transparent",
                      },
                    ]}
                    testID={`type-${type.value}`}
                  >
                    <Feather name={type.icon} size={20} color={isSelected ? colors.primary : colors.mutedForeground} />
                    <Text style={[styles.typeBtnLabel, { color: isSelected ? colors.primary : colors.foreground }]}>
                      {type.label}
                    </Text>
                    <Text style={[styles.typeBtnDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {type.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Recipients</Text>
            <Pressable
              onPress={() => {
                setSendToAll(!sendToAll);
                Haptics.selectionAsync();
              }}
              style={[
                styles.allGuestsRow,
                { backgroundColor: colors.muted, borderColor: sendToAll ? colors.primary : "transparent" },
              ]}
              testID="all-guests-toggle"
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: sendToAll ? colors.primary : colors.mutedForeground,
                    backgroundColor: sendToAll ? colors.primary : "transparent",
                  },
                ]}
              >
                {sendToAll && <Feather name="check" size={12} color={colors.primaryForeground} />}
              </View>
              <Text style={[styles.allGuestsText, { color: colors.foreground }]}>All Guests</Text>
            </Pressable>

            {!sendToAll && (
              <View style={[styles.inputWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                <Feather name="home" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="Room number (e.g. 12 or B4)"
                  placeholderTextColor={colors.mutedForeground}
                  value={targetRoom}
                  onChangeText={setTargetRoom}
                  autoCapitalize="characters"
                  testID="room-target-input"
                />
              </View>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Message (optional)</Text>
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Leave blank to use the default message for the selected type.
            </Text>
            <View style={[styles.inputWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Custom title"
                placeholderTextColor={colors.mutedForeground}
                value={customTitle}
                onChangeText={setCustomTitle}
                testID="custom-title-input"
              />
            </View>
            <View style={[styles.textAreaWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
              <TextInput
                style={[styles.textArea, { color: colors.foreground }]}
                placeholder="Custom message body"
                placeholderTextColor={colors.mutedForeground}
                value={customBody}
                onChangeText={setCustomBody}
                multiline
                numberOfLines={3}
                testID="custom-body-input"
              />
            </View>
          </View>

          {sendResult && (
            <View
              style={[
                styles.resultBanner,
                { backgroundColor: sendResult.success ? colors.success + "20" : colors.destructive + "20" },
              ]}
            >
              <Feather
                name={sendResult.success ? "check-circle" : "x-circle"}
                size={18}
                color={sendResult.success ? colors.success : colors.destructive}
              />
              <Text style={[styles.resultText, { color: sendResult.success ? colors.success : colors.destructive }]}>
                {sendResult.message}
              </Text>
            </View>
          )}

          <Pressable
            onPress={handleSend}
            disabled={isSending}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: colors.primary, opacity: pressed || isSending ? 0.8 : 1 },
            ]}
            testID="send-button"
          >
            {isSending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="send" size={18} color={colors.primaryForeground} />
                <Text style={[styles.sendButtonText, { color: colors.primaryForeground }]}>Send Notification</Text>
              </>
            )}
          </Pressable>

          {/* ── Maintenance Requests ── */}
          <View style={styles.maintenanceTitleRow}>
            <Text style={[styles.subHeading, { color: colors.foreground }]}>Maintenance Requests</Text>
            <Pressable
              onPress={() => fetchReports(true)}
              style={[styles.refreshBtn, { backgroundColor: colors.muted }]}
              hitSlop={8}
            >
              <Feather name="refresh-cw" size={15} color={colors.primary} />
            </Pressable>
          </View>

          {reportsLoading ? (
            <View style={styles.reportsLoader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : reports.length === 0 ? (
            <View style={[styles.emptyReports, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-circle" size={28} color={colors.success} />
              <Text style={[styles.emptyReportsText, { color: colors.mutedForeground }]}>
                No open maintenance requests
              </Text>
            </View>
          ) : (
            <>
              {urgentReports.length > 0 && (
                <View style={styles.urgencyGroup}>
                  <View style={styles.urgencyLabelRow}>
                    <View style={[styles.urgencyDot, { backgroundColor: colors.destructive }]} />
                    <Text style={[styles.urgencyLabel, { color: colors.destructive }]}>Urgent</Text>
                    <View style={[styles.urgencyBadge, { backgroundColor: colors.destructive }]}>
                      <Text style={styles.urgencyBadgeText}>{urgentReports.length}</Text>
                    </View>
                  </View>
                  {urgentReports.map((report) => (
                    <ReportCard
                      key={report.id}
                      report={report}
                      colors={colors}
                      onDelete={() => openSignOff(report)}
                      onPreviewPhoto={setPreviewPhoto}
                    />
                  ))}
                </View>
              )}

              {nonUrgentReports.length > 0 && (
                <View style={styles.urgencyGroup}>
                  <View style={styles.urgencyLabelRow}>
                    <View style={[styles.urgencyDot, { backgroundColor: colors.warning }]} />
                    <Text style={[styles.urgencyLabel, { color: colors.warning }]}>Non-urgent</Text>
                    <View style={[styles.urgencyBadge, { backgroundColor: colors.warning }]}>
                      <Text style={styles.urgencyBadgeText}>{nonUrgentReports.length}</Text>
                    </View>
                  </View>
                  {nonUrgentReports.map((report) => (
                    <ReportCard
                      key={report.id}
                      report={report}
                      colors={colors}
                      onDelete={() => openSignOff(report)}
                      onPreviewPhoto={setPreviewPhoto}
                    />
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Resolved History ── */}
          <Pressable
            onPress={() => {
              setHistoryExpanded((v) => !v);
              Haptics.selectionAsync();
            }}
            style={[styles.historyToggleRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
            testID="history-toggle"
          >
            <View style={[styles.historyToggleIcon, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="archive" size={16} color={colors.primary} />
            </View>
            <Text style={[styles.historyToggleLabel, { color: colors.foreground }]}>
              Resolved History
            </Text>
            {resolvedReports.length > 0 && (
              <View style={[styles.historyBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.historyBadgeText}>{resolvedReports.length}</Text>
              </View>
            )}
            <Feather
              name={historyExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.mutedForeground}
              style={{ marginLeft: "auto" }}
            />
          </Pressable>

          {historyExpanded && (
            <>
              {/* Filter controls */}
              <View style={[styles.historyFilters, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.historyFilterGroup}>
                  <Text style={[styles.historyFilterLabel, { color: colors.mutedForeground }]}>Date</Text>
                  <View style={styles.historyFilterChips}>
                    {(["today", "week", "all"] as const).map((opt) => (
                      <Pressable
                        key={opt}
                        onPress={() => setHistoryDateFilter(opt)}
                        style={[
                          styles.filterChip,
                          historyDateFilter === opt
                            ? { backgroundColor: colors.primary }
                            : { backgroundColor: colors.muted, borderColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            { color: historyDateFilter === opt ? "#fff" : colors.mutedForeground },
                          ]}
                        >
                          {opt === "today" ? "Today" : opt === "week" ? "This Week" : "All Time"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={styles.historyFilterGroup}>
                  <Text style={[styles.historyFilterLabel, { color: colors.mutedForeground }]}>Type</Text>
                  <View style={styles.historyFilterChips}>
                    {(["all", "actioned", "delegated"] as const).map((opt) => (
                      <Pressable
                        key={opt}
                        onPress={() => setHistoryResolutionFilter(opt)}
                        style={[
                          styles.filterChip,
                          historyResolutionFilter === opt
                            ? { backgroundColor: colors.primary }
                            : { backgroundColor: colors.muted, borderColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            { color: historyResolutionFilter === opt ? "#fff" : colors.mutedForeground },
                          ]}
                        >
                          {opt === "all" ? "All" : opt === "actioned" ? "Actioned" : "Delegated"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Search */}
                <View style={[styles.historySearchWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                  <Feather name="search" size={15} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.historySearchInput, { color: colors.foreground }]}
                    placeholder="Search guest, room or title…"
                    placeholderTextColor={colors.mutedForeground}
                    value={historySearchQuery}
                    onChangeText={setHistorySearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    testID="history-search-input"
                  />
                  {historySearchQuery.length > 0 && (
                    <Pressable onPress={() => setHistorySearchQuery("")} hitSlop={8}>
                      <Feather name="x" size={15} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                </View>

                <Pressable
                  onPress={handleExport}
                  disabled={isExporting}
                  style={({ pressed }) => [
                    styles.exportBtn,
                    {
                      backgroundColor: colors.primary + "12",
                      borderColor: colors.primary + "40",
                      opacity: pressed || isExporting ? 0.7 : 1,
                    },
                  ]}
                  testID="export-csv-btn"
                >
                  {isExporting ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather name="share" size={15} color={colors.primary} />
                  )}
                  <Text style={[styles.exportBtnText, { color: colors.primary }]}>
                    {isExporting ? "Exporting…" : "Export CSV"}
                  </Text>
                </Pressable>
              </View>

              {filteredResolvedReports.length === 0 ? (
                <View style={[styles.emptyReports, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="inbox" size={22} color={colors.mutedForeground} />
                  <Text style={[styles.emptyReportsText, { color: colors.mutedForeground }]}>
                    {resolvedReports.length === 0
                      ? "No resolved requests yet"
                      : "No results match the selected filters"}
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {filteredResolvedReports.map((report) => (
                    <ResolvedReportCard
                      key={report.id}
                      report={report}
                      colors={colors}
                      onPreviewPhoto={setPreviewPhoto}
                      authToken={authToken}
                      baseUrl={baseUrl}
                      onNoteUpdated={(id, note, editedByName, editedAt) => {
                        setResolvedReports((prev) =>
                          prev.map((r) =>
                            r.id === id
                              ? { ...r, resolutionNote: note, resolutionNoteEditedByName: editedByName, resolutionNoteEditedAt: editedAt }
                              : r
                          )
                        );
                      }}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Sign-off Modal ── */}
      <Modal
        visible={!!signOffReport}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSignOff}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View
            style={[
              styles.modalHeader,
              {
                paddingTop: Platform.OS === "web" ? 20 : insets.top + 16,
                borderBottomColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <View style={[styles.modalIconWrap, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="clipboard" size={24} color={colors.destructive} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Sign off before deleting</Text>
              <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                {signOffReport?.title}
              </Text>
            </View>
            <Pressable
              onPress={closeSignOff}
              style={[styles.modalCloseBtn, { backgroundColor: colors.muted }]}
              hitSlop={12}
            >
              <Feather name="x" size={18} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={[styles.modalBody, { paddingBottom: insets.bottom + 40 }]}>
            <Text style={[styles.modalBodyLabel, { color: colors.mutedForeground }]}>
              How was this request handled? Select one before confirming.
            </Text>

            <Pressable
              onPress={() => {
                setSelectedResolution("actioned");
                Haptics.selectionAsync();
              }}
              style={[
                styles.resolutionOption,
                {
                  backgroundColor:
                    selectedResolution === "actioned" ? colors.success + "15" : colors.muted,
                  borderColor:
                    selectedResolution === "actioned" ? colors.success : colors.border,
                  borderWidth: selectedResolution === "actioned" ? 1.5 : 1,
                },
              ]}
            >
              <View style={[styles.resolutionIcon, { backgroundColor: colors.success + "20" }]}>
                <Feather name="check-circle" size={22} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.resolutionTitle, { color: colors.foreground }]}>Actioned</Text>
                <Text style={[styles.resolutionHint, { color: colors.mutedForeground }]}>
                  Issue was handled directly by staff
                </Text>
              </View>
              {selectedResolution === "actioned" && (
                <Feather name="check" size={18} color={colors.success} />
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                setSelectedResolution("delegated");
                Haptics.selectionAsync();
              }}
              style={[
                styles.resolutionOption,
                {
                  backgroundColor:
                    selectedResolution === "delegated" ? colors.primary + "15" : colors.muted,
                  borderColor:
                    selectedResolution === "delegated" ? colors.primary : colors.border,
                  borderWidth: selectedResolution === "delegated" ? 1.5 : 1,
                },
              ]}
            >
              <View style={[styles.resolutionIcon, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="share-2" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.resolutionTitle, { color: colors.foreground }]}>Delegated</Text>
                <Text style={[styles.resolutionHint, { color: colors.mutedForeground }]}>
                  Passed to maintenance department
                </Text>
              </View>
              {selectedResolution === "delegated" && (
                <Feather name="check" size={18} color={colors.primary} />
              )}
            </Pressable>

            <View style={[styles.noteInputWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
              <Feather name="edit-3" size={16} color={colors.mutedForeground} style={{ marginTop: 2 }} />
              <TextInput
                style={[styles.noteInput, { color: colors.foreground }]}
                placeholder="Add a note (optional) — e.g. Plumber called, arriving Wednesday"
                placeholderTextColor={colors.mutedForeground}
                value={resolutionNote}
                onChangeText={setResolutionNote}
                multiline
                numberOfLines={3}
                testID="resolution-note-input"
              />
            </View>

            <Pressable
              onPress={handleConfirmResolve}
              disabled={!selectedResolution || isResolving}
              style={({ pressed }) => [
                styles.confirmBtn,
                {
                  backgroundColor: selectedResolution ? colors.destructive : colors.muted,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {isResolving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather
                    name="trash-2"
                    size={18}
                    color={selectedResolution ? "#fff" : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.confirmBtnText,
                      { color: selectedResolution ? "#fff" : colors.mutedForeground },
                    ]}
                  >
                    Confirm &amp; delete
                  </Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Full-screen photo preview ── */}
      <Modal
        visible={!!previewPhoto}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <Pressable
          style={styles.photoPreviewOverlay}
          onPress={() => setPreviewPhoto(null)}
        >
          {previewPhoto && (
            <Image
              source={{ uri: previewPhoto }}
              style={styles.photoPreviewImage}
              contentFit="contain"
            />
          )}
          <Pressable
            style={[styles.photoPreviewClose, { backgroundColor: colors.card }]}
            onPress={() => setPreviewPhoto(null)}
          >
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ReportCard({
  report,
  colors,
  onDelete,
  onPreviewPhoto,
}: {
  report: MaintenanceReport;
  colors: ReturnType<typeof useColors>;
  onDelete: () => void;
  onPreviewPhoto: (uri: string) => void;
}) {
  return (
    <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.reportCardTop}>
        <View style={styles.reportCardMeta}>
          <View style={styles.reportCardBadgeRow}>
            <View style={[styles.roomBadge, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="home" size={12} color={colors.primary} />
              <Text style={[styles.roomBadgeText, { color: colors.primary }]}>Room {report.roomNumber}</Text>
            </View>
            <View
              style={[
                styles.urgencyPill,
                {
                  backgroundColor:
                    report.urgency === "urgent" ? colors.destructive + "20" : colors.warning + "20",
                },
              ]}
            >
              <Text
                style={[
                  styles.urgencyPillText,
                  { color: report.urgency === "urgent" ? colors.destructive : colors.warning },
                ]}
              >
                {report.urgency === "urgent" ? "Urgent" : "Non-urgent"}
              </Text>
            </View>
          </View>
          <Text style={[styles.reportGuest, { color: colors.mutedForeground }]}>{report.guestName}</Text>
        </View>
        <Text style={[styles.reportTime, { color: colors.mutedForeground }]}>
          {formatRelativeTime(report.createdAt)}
        </Text>
      </View>

      <Text style={[styles.reportTitle, { color: colors.foreground }]}>{report.title}</Text>
      <Text style={[styles.reportDescription, { color: colors.mutedForeground }]} numberOfLines={2}>
        {report.description}
      </Text>

      {report.photos && report.photos.length > 0 && (
        <View style={styles.photoStrip}>
          {report.photos.map((uri, idx) => (
            <Pressable
              key={idx}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPreviewPhoto(uri);
              }}
              style={[styles.photoStripThumb, { borderColor: colors.border }]}
            >
              <Image
                source={{ uri }}
                style={styles.photoStripImage}
                contentFit="cover"
              />
              {report.photos && report.photos.length > 2 && idx === 1 && (
                <View style={[styles.photoStripMore, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
                  <Text style={styles.photoStripMoreText}>+{report.photos.length - 2}</Text>
                </View>
              )}
            </Pressable>
          ))}
          <View style={[styles.photoCountBadge, { backgroundColor: colors.primary + "15" }]}>
            <Feather name="image" size={11} color={colors.primary} />
            <Text style={[styles.photoCountText, { color: colors.primary }]}>
              {report.photos.length} photo{report.photos.length !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.reportCardBottom}>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => [
            styles.deleteBtn,
            { backgroundColor: colors.destructive + "15", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="trash-2" size={14} color={colors.destructive} />
          <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ResolvedReportCard({
  report,
  colors,
  onPreviewPhoto,
  authToken,
  baseUrl,
  onNoteUpdated,
}: {
  report: MaintenanceReport;
  colors: ReturnType<typeof useColors>;
  onPreviewPhoto: (uri: string) => void;
  authToken: string;
  baseUrl: string;
  onNoteUpdated: (id: number, note: string | null, editedByName: string | null, editedAt: string | null) => void;
}) {
  const resolution = report.resolution;
  const isActioned = resolution === "actioned";
  const isDelegated = resolution === "delegated";
  const resolutionColor = isActioned ? colors.success : isDelegated ? colors.primary : colors.mutedForeground;
  const resolutionLabel = isActioned ? "Actioned" : isDelegated ? "Delegated" : "Unknown";
  const resolutionIcon: keyof typeof Feather.glyphMap = isActioned ? "check-circle" : isDelegated ? "share-2" : "help-circle";

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editNoteText, setEditNoteText] = useState(report.resolutionNote ?? "");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSaveNote() {
    setIsSavingNote(true);
    setSaveError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const resp = await fetch(`${baseUrl}/api/maintenance/${report.id}/note`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ resolutionNote: editNoteText.trim() || null }),
      });
      if (resp.ok) {
        const updated = await resp.json() as MaintenanceReport;
        onNoteUpdated(
          report.id,
          updated.resolutionNote ?? null,
          updated.resolutionNoteEditedByName ?? null,
          updated.resolutionNoteEditedAt ?? null,
        );
        setIsEditingNote(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (resp.status === 401) {
        setSaveError("Session expired — please log in again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        setSaveError("Could not save note. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      setSaveError("Could not reach the server. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSavingNote(false);
    }
  }

  function handleCancelEdit() {
    setEditNoteText(report.resolutionNote ?? "");
    setSaveError(null);
    setIsEditingNote(false);
  }

  return (
    <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.85 }]}>
      <View style={styles.reportCardTop}>
        <View style={styles.reportCardMeta}>
          <View style={styles.reportCardBadgeRow}>
            <View style={[styles.roomBadge, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="home" size={12} color={colors.primary} />
              <Text style={[styles.roomBadgeText, { color: colors.primary }]}>Room {report.roomNumber}</Text>
            </View>
            <View style={[styles.resolutionPill, { backgroundColor: resolutionColor + "20" }]}>
              <Feather name={resolutionIcon} size={11} color={resolutionColor} />
              <Text style={[styles.resolutionPillText, { color: resolutionColor }]}>{resolutionLabel}</Text>
            </View>
          </View>
          <Text style={[styles.reportGuest, { color: colors.mutedForeground }]}>{report.guestName}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={[styles.reportTime, { color: colors.mutedForeground }]}>
            {formatRelativeTime(report.createdAt)}
          </Text>
          {report.resolvedAt && (
            <Text style={[styles.resolvedAtText, { color: colors.mutedForeground }]}>
              Resolved {formatRelativeTime(report.resolvedAt)}
            </Text>
          )}
        </View>
      </View>
      {report.resolvedByName && (
        <View style={styles.resolvedByRow}>
          <Feather name="user-check" size={12} color={colors.mutedForeground} />
          <Text style={[styles.resolvedByText, { color: colors.mutedForeground }]}>
            Resolved by {report.resolvedByName}
          </Text>
        </View>
      )}

      {isEditingNote ? (
        <View style={styles.noteEditBlock}>
          <View style={[styles.noteInputWrapper, { borderColor: colors.input, backgroundColor: colors.muted }]}>
            <Feather name="edit-3" size={15} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <TextInput
              style={[styles.noteInput, { color: colors.foreground }]}
              placeholder="Add a note — e.g. Plumber called, arriving Wednesday"
              placeholderTextColor={colors.mutedForeground}
              value={editNoteText}
              onChangeText={setEditNoteText}
              multiline
              numberOfLines={3}
              autoFocus
            />
          </View>
          <View style={styles.noteEditActions}>
            <Pressable
              onPress={handleCancelEdit}
              disabled={isSavingNote}
              style={[styles.noteActionBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
            >
              <Text style={[styles.noteActionBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSaveNote}
              disabled={isSavingNote}
              style={({ pressed }) => [
                styles.noteActionBtn,
                styles.noteActionBtnPrimary,
                { backgroundColor: colors.primary, opacity: pressed || isSavingNote ? 0.8 : 1 },
              ]}
            >
              {isSavingNote
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[styles.noteActionBtnText, { color: "#fff" }]}>Save</Text>
              }
            </Pressable>
          </View>
          {saveError && (
            <View style={[styles.noteSaveError, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="alert-circle" size={12} color={colors.destructive} />
              <Text style={[styles.noteSaveErrorText, { color: colors.destructive }]}>{saveError}</Text>
            </View>
          )}
        </View>
      ) : (
        <Pressable
          onPress={() => {
            setEditNoteText(report.resolutionNote ?? "");
            setIsEditingNote(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={({ pressed }) => [
            styles.resolutionNoteRow,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          testID={`edit-note-${report.id}`}
        >
          <Feather name="edit-3" size={12} color={colors.mutedForeground} />
          <View style={{ flex: 1, gap: 3 }}>
            {report.resolutionNote ? (
              <Text style={[styles.resolutionNoteText, { color: colors.mutedForeground }]}>
                {report.resolutionNote}
              </Text>
            ) : (
              <Text style={[styles.resolutionNoteText, { color: colors.mutedForeground, fontStyle: "italic" }]}>
                Tap to add a note…
              </Text>
            )}
            {report.resolutionNoteEditedByName && report.resolutionNoteEditedAt && (
              <Text style={[styles.noteEditedByText, { color: colors.mutedForeground }]}>
                Edited by {report.resolutionNoteEditedByName} on {new Date(report.resolutionNoteEditedAt).toLocaleDateString()}
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={12} color={colors.mutedForeground} />
        </Pressable>
      )}

      <Text style={[styles.reportTitle, { color: colors.foreground }]}>{report.title}</Text>
      <Text style={[styles.reportDescription, { color: colors.mutedForeground }]} numberOfLines={2}>
        {report.description}
      </Text>

      {report.photos && report.photos.length > 0 && (
        <View style={styles.photoStrip}>
          {report.photos.map((uri, idx) => (
            <Pressable
              key={idx}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPreviewPhoto(uri);
              }}
              style={[styles.photoStripThumb, { borderColor: colors.border }]}
            >
              <Image
                source={{ uri }}
                style={styles.photoStripImage}
                contentFit="cover"
              />
              {report.photos && report.photos.length > 2 && idx === 1 && (
                <View style={[styles.photoStripMore, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
                  <Text style={styles.photoStripMoreText}>+{report.photos.length - 2}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pinContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  lockIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  pinTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  pinSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  pinInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    gap: 10,
    width: "100%",
    marginTop: 8,
  },
  pinInput: { flex: 1, fontSize: 20, fontFamily: "Inter_400Regular", letterSpacing: 4 },
  pinError: { fontSize: 13, fontFamily: "Inter_400Regular" },
  pinButton: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  pinButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  scrollContent: { paddingHorizontal: 16, gap: 14 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subHeading: { fontSize: 18, fontFamily: "Inter_600SemiBold", paddingHorizontal: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -4 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeBtn: {
    width: "48%",
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    gap: 4,
    alignItems: "flex-start",
  },
  typeBtnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  typeBtnDesc: { fontSize: 11, fontFamily: "Inter_400Regular" },
  allGuestsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  allGuestsText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  textAreaWrapper: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  textArea: { fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 72, lineHeight: 20 },
  resultBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
  },
  resultText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 54,
    borderRadius: 14,
    gap: 10,
  },
  sendButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  maintenanceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: 6,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  reportsLoader: { paddingVertical: 32, alignItems: "center" },
  emptyReports: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptyReportsText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  urgencyGroup: { gap: 10 },
  urgencyLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  },
  urgencyDot: { width: 8, height: 8, borderRadius: 4 },
  urgencyLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  urgencyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  urgencyBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  reportCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  reportCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  reportCardMeta: { gap: 4, flex: 1 },
  reportCardBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  urgencyPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  urgencyPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  roomBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  roomBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  reportGuest: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reportTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reportTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  reportDescription: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  reportCardBottom: { flexDirection: "row", justifyContent: "flex-end" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  photoStrip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  photoStripThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
  },
  photoStripImage: { width: "100%", height: "100%" },
  photoStripMore: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  photoStripMoreText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  photoCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "center",
  },
  photoCountText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPreviewImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.8,
  },
  photoPreviewClose: {
    position: "absolute",
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: { padding: 20, gap: 14 },
  modalBodyLabel: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  resolutionOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
  },
  resolutionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  resolutionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  resolutionHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 14,
    marginTop: 6,
  },
  confirmBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  historyToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 6,
  },
  historyToggleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  historyToggleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  historyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  historyBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  resolutionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  resolutionPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  resolvedAtText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  resolvedByRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  resolvedByText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  noteEditedByText: { fontSize: 10, fontFamily: "Inter_400Regular", opacity: 0.7 },
  noteInputWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  noteInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 60, lineHeight: 20 },
  resolutionNoteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  resolutionNoteText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  noteEditBlock: { gap: 8 },
  noteEditActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  noteActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
  },
  noteActionBtnPrimary: { borderWidth: 0 },
  noteActionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noteSaveError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  noteSaveErrorText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
  historyFilters: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
    marginBottom: 4,
  },
  historyFilterGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  historyFilterLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    minWidth: 32,
  },
  historyFilterChips: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    flex: 1,
  },
  filterChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterChipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  historySearchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
  },
  historySearchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  exportBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
