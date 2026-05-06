import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export type NotificationType = "room_ready" | "activity" | "checkout_reminder" | "general";

export interface NotificationItem {
  id: number;
  title: string;
  body: string;
  type: NotificationType;
  targetRoom: string;
  sentAt: string;
  recipientCount: number;
}

function getTypeConfig(type: NotificationType, colors: ReturnType<typeof useColors>) {
  switch (type) {
    case "room_ready":
      return { icon: "check-circle" as const, color: colors.success, label: "Room Ready" };
    case "activity":
      return { icon: "calendar" as const, color: colors.primary, label: "Activity" };
    case "checkout_reminder":
      return { icon: "clock" as const, color: colors.warning, label: "Check-out" };
    case "general":
    default:
      return { icon: "bell" as const, color: colors.accent, label: "General" };
  }
}

function formatTime(isoString: string): string {
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

function formatFullDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  notification: NotificationItem;
  onDelete: (id: number) => void;
}

export function NotificationCard({ notification, onDelete }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const config = getTypeConfig(notification.type as NotificationType, colors);
  const [modalVisible, setModalVisible] = useState(false);

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setModalVisible(true);
  }

  function handleClose() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setModalVisible(false);
  }

  function handleDelete() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setModalVisible(false);
    onDelete(notification.id);
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={[styles.iconContainer, { backgroundColor: config.color + "20" }]}>
          <Feather name={config.icon} size={22} color={config.color} />
        </View>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
              {notification.title}
            </Text>
            <Text style={[styles.time, { color: colors.mutedForeground }]}>
              {formatTime(notification.sentAt)}
            </Text>
          </View>
          <Text style={[styles.body, { color: colors.mutedForeground }]} numberOfLines={2}>
            {notification.body}
          </Text>
          <View style={styles.footer}>
            <View style={[styles.badge, { backgroundColor: config.color + "15" }]}>
              <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
            </View>
            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
          </View>
        </View>
      </Pressable>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleClose}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[
            styles.modalHeader,
            {
              paddingTop: Platform.OS === "web" ? 20 : insets.top + 12,
              borderBottomColor: colors.border,
              backgroundColor: colors.card,
            }
          ]}>
            <View style={styles.modalHeaderInner}>
              <View style={[styles.modalIconLarge, { backgroundColor: config.color + "20" }]}>
                <Feather name={config.icon} size={28} color={config.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={[styles.badge, { backgroundColor: config.color + "15", alignSelf: "flex-start" }]}>
                  <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
                </View>
              </View>
              <Pressable
                onPress={handleClose}
                style={[styles.closeBtn, { backgroundColor: colors.muted }]}
                hitSlop={12}
              >
                <Feather name="x" size={18} color={colors.foreground} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.modalBody,
              { paddingBottom: insets.bottom + 100 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {notification.title}
            </Text>

            <Text style={[styles.modalBodyText, { color: colors.foreground }]}>
              {notification.body}
            </Text>

            <View style={[styles.metaCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <View style={styles.metaRow}>
                <Feather name="clock" size={14} color={colors.mutedForeground} />
                <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Received</Text>
                <Text style={[styles.metaValue, { color: colors.foreground }]}>
                  {formatFullDate(notification.sentAt)}
                </Text>
              </View>
              {notification.targetRoom !== "all" && (
                <View style={styles.metaRow}>
                  <Feather name="home" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Room</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>
                    {notification.targetRoom}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>

          <View style={[
            styles.deleteFooter,
            {
              paddingBottom: insets.bottom + 16,
              borderTopColor: colors.border,
              backgroundColor: colors.card,
            }
          ]}>
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [
                styles.deleteBtn,
                { backgroundColor: colors.destructive, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Feather name="trash-2" size={18} color="#fff" />
              <Text style={styles.deleteBtnText}>Delete notification</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  time: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  body: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  modalHeaderInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  modalIconLarge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: {
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  modalBodyText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    lineHeight: 26,
  },
  metaCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginTop: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    width: 64,
  },
  metaValue: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  deleteFooter: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 14,
  },
  deleteBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
