import React from "react";
import {
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  StyleSheet,
  type TextStyle,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  type PanGesture,
} from "react-native-gesture-handler";
import MarkdownDisplay from "react-native-markdown-display";
import { colors, radius, spacing } from "../theme";
import { formatStudyMarkdown } from "../markdown-format";
import { studyMarkdownParser } from "../study-markdown-parser";

function HorizontalContent({
  turnGesture,
  children,
  ...props
}: ScrollViewProps & { turnGesture?: PanGesture }) {
  const content = (
    <ScrollView {...props} horizontal>
      {children}
    </ScrollView>
  );
  if (!turnGesture) return content;
  // Horizontal code/table scrolling takes precedence over turning the question.
  return (
    <GestureDetector
      gesture={Gesture.Native().blocksExternalGesture(turnGesture)}
      touchAction="pan-x"
    >
      {content}
    </GestureDetector>
  );
}

export function Markdown({
  children,
  turnGesture,
  selectable = true,
}: {
  children: string;
  turnGesture?: PanGesture;
  selectable?: boolean;
}) {
  return (
    <MarkdownDisplay
      markdownit={studyMarkdownParser}
      onLinkPress={(url) => {
        if (/^https?:\/\//i.test(url))
          void Linking.openURL(url).catch(() => undefined);
        return false;
      }}
      rules={{
        textgroup: (node, children, parents, markdownStyles) => {
          const inherited: TextStyle = {
            color: colors.text,
            fontSize: 16,
            lineHeight: 27,
          };
          for (const parent of [...parents].reverse()) {
            const parentStyle =
              StyleSheet.flatten(markdownStyles[parent.type]) || {};
            for (const key of [
              "color",
              "fontSize",
              "lineHeight",
              "fontWeight",
              "fontStyle",
              "fontFamily",
            ] as const) {
              if (parentStyle[key] !== undefined)
                Object.assign(inherited, { [key]: parentStyle[key] });
            }
          }
          return (
            <Text
              key={node.key}
              selectable={selectable}
              style={[
                inherited,
                { flexShrink: 1, minWidth: 0, maxWidth: "100%" },
              ]}
            >
              {children}
            </Text>
          );
        },
        ordered_list: (node, children) => (
          <View
            key={node.key}
            style={{
              alignSelf: "stretch",
              flexDirection: "column",
              marginBottom: spacing.md,
            }}
          >
            {children}
          </View>
        ),
        bullet_list: (node, children) => (
          <View
            key={node.key}
            style={{
              alignSelf: "stretch",
              flexDirection: "column",
              marginBottom: spacing.md,
            }}
          >
            {children}
          </View>
        ),
        list_item: (node, children, parents) => {
          const list = parents.find(
            (parent) =>
              parent.type === "ordered_list" || parent.type === "bullet_list",
          );
          const marker =
            list?.type === "ordered_list"
              ? `${Number(list.attributes.start || 1) + node.index}.`
              : "•";
          return (
            <View
              key={node.key}
              testID="markdown-list-item"
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                marginBottom: spacing.sm,
              }}
            >
              <Text
                style={{
                  width: Math.max(32, marker.length * 9 + 8),
                  flexShrink: 0,
                  fontSize: 16,
                  lineHeight: 27,
                  color: colors.primary,
                }}
              >
                {marker}
              </Text>
              <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
                {children}
              </View>
            </View>
          );
        },
        code_block: (node) => (
          <HorizontalContent
            key={node.key}
            turnGesture={turnGesture}
            style={{ backgroundColor: colors.input, borderRadius: radius.sm }}
            contentContainerStyle={{ padding: spacing.md }}
          >
            <Text
              selectable={selectable}
              style={{
                color: colors.text,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                fontSize: 14,
                lineHeight: 22,
              }}
            >
              {node.content.replace(/\n$/, "")}
            </Text>
          </HorizontalContent>
        ),
        fence: (node) => (
          <HorizontalContent
            key={node.key}
            turnGesture={turnGesture}
            style={{ backgroundColor: colors.input, borderRadius: radius.sm }}
            contentContainerStyle={{ padding: spacing.md }}
          >
            <Text
              selectable={selectable}
              style={{
                color: colors.text,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                fontSize: 14,
                lineHeight: 22,
              }}
            >
              {node.content.replace(/\n$/, "")}
            </Text>
          </HorizontalContent>
        ),
        table: (node, children) => (
          <HorizontalContent key={node.key} turnGesture={turnGesture}>
            <View>{children}</View>
          </HorizontalContent>
        ),
      }}
      style={{
        body: { color: colors.text, fontSize: 16, lineHeight: 27 },
        paragraph: { marginTop: 0, marginBottom: spacing.md },
        heading1: {
          fontSize: 22,
          lineHeight: 32,
          fontWeight: "700",
          marginBottom: spacing.md,
        },
        heading2: {
          fontSize: 18,
          lineHeight: 28,
          fontWeight: "700",
          marginBottom: spacing.sm,
        },
        heading3: {
          fontSize: 16,
          lineHeight: 26,
          fontWeight: "600",
          marginBottom: spacing.sm,
        },
        code_inline: { backgroundColor: colors.input, color: colors.primary },
        fence: {
          backgroundColor: colors.input,
          borderColor: colors.border,
          fontSize: 13,
          lineHeight: 21,
        },
        link: { color: colors.primary },
        table: { borderColor: colors.border, marginBottom: spacing.md },
        th: { width: 160, flex: 0, flexBasis: "auto", flexShrink: 0, padding: spacing.sm, backgroundColor: colors.input, fontWeight: "600" },
        td: { width: 160, flex: 0, flexBasis: "auto", flexShrink: 0, padding: spacing.sm },
        tr: { borderColor: colors.border },
      }}
    >
      {formatStudyMarkdown(children || "暂无内容")}
    </MarkdownDisplay>
  );
}
