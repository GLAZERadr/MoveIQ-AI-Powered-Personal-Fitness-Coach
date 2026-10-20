import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator, Alert, KeyboardTypeOptions, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, View, ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MIN_TOUCH, useTheme } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, padded = true, edges = ['top'] as const }: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: readonly ('top' | 'bottom')[];
}) {
  const { colors, spacing } = useTheme();
  const inner = padded ? { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={edges as ('top' | 'bottom')[]}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  const { colors, font } = useTheme();
  return (
    <View accessibilityRole="header">
      <Text style={[font.heading, { color: colors.text }]}>{children}</Text>
      {subtitle ? <Text style={[font.body, { color: colors.textMuted, marginTop: 2 }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const { colors, font } = useTheme();
  return (
    <View style={styles.rowBetween}>
      <Text accessibilityRole="header" style={[font.title, { color: colors.text, fontSize: 17 }]}>{title}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={12} accessibilityRole="button">
          <Text style={[font.bodyStrong, { color: colors.primary }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors, radius, spacing } = useTheme();
  const base = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: spacing.sm };
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [base, pressed && { opacity: 0.7 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]} accessibilityLabel={accessibilityLabel}>{children}</View>;
}

/** Labels where a number came from. Never present an estimate as a measurement. */
export type Provenance = 'manual' | 'calculated' | 'estimate' | 'camera' | 'rule';
const PROVENANCE_LABEL: Record<Provenance, string> = {
  manual: 'Entered',
  calculated: 'Calculated',
  estimate: 'Estimate',
  camera: 'Camera-derived',
  rule: 'Suggestion',
};

export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  const { colors, font, radius } = useTheme();
  const tone = kind === 'estimate' ? colors.warning : kind === 'camera' ? colors.info : colors.textMuted;
  return (
    <View style={{ borderWidth: 1, borderColor: tone, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start' }}>
      <Text style={[font.caption, { color: tone, fontSize: 10, lineHeight: 14 }]}>{PROVENANCE_LABEL[kind]}</Text>
    </View>
  );
}

export function MetricCard({ label, value, unit, sub, subTone, provenance, onPress, style, children }: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  subTone?: 'good' | 'bad' | 'muted';
  provenance?: Provenance;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const { colors, font } = useTheme();
  const subColor = subTone === 'good' ? colors.primary : subTone === 'bad' ? colors.danger : colors.textMuted;
  return (
    <Card style={[{ flex: 1, minWidth: 140 }, style]} onPress={onPress} accessibilityLabel={`${label}: ${value} ${unit ?? ''}. ${sub ?? ''}`}>
      <View style={styles.rowBetween}>
        <Text style={[font.caption, { color: colors.textMuted }]}>{label}</Text>
        {provenance ? <ProvenanceBadge kind={provenance} /> : null}
      </View>
      <Text style={[font.metric, { color: colors.text }]}>
        {value}
        {unit ? <Text style={[font.body, { color: colors.textMuted }]}> {unit}</Text> : null}
      </Text>
      {sub ? <Text style={[font.caption, { color: subColor }]}>{sub}</Text> : null}
      {children}
    </Card>
  );
}

export function Row({ children, gap = 12, wrap = true }: { children: React.ReactNode; gap?: number; wrap?: boolean }) {
  return <View style={{ flexDirection: 'row', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, accessibilityHint, style }: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, font, radius } = useTheme();
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? '#fff' : variant === 'secondary' ? colors.text : colors.primary;
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        { minHeight: MIN_TOUCH, borderRadius: radius.pill, backgroundColor: bg, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
        pressed && { opacity: 0.8 },
        inactive && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[font.bodyStrong, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, size = 28, color, style }: {
  icon: IconName; onPress: () => void; label: string; size?: number; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => [{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }, style]}>
      <Ionicons name={icon} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

export function TextField({ label, value, onChangeText, error, placeholder, keyboardType, suffix, multiline, hint, autoFocus }: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  error?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  suffix?: string;
  multiline?: boolean;
  hint?: string;
  autoFocus?: boolean;
}) {
  const { colors, font, radius } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={[font.caption, { color: colors.textMuted, fontWeight: '600' }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: error ? colors.danger : colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          multiline={multiline}
          autoFocus={autoFocus}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          style={[font.body, { flex: 1, color: colors.text, minHeight: MIN_TOUCH, paddingVertical: 10 }, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
        />
        {suffix ? <Text style={[font.body, { color: colors.textMuted }]}>{suffix}</Text> : null}
      </View>
      {error ? <Text accessibilityLiveRegion="polite" style={[font.caption, { color: colors.danger }]}>{error}</Text> : hint ? <Text style={[font.caption, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const { colors, font, radius } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={[font.caption, { color: colors.textMuted, fontWeight: '600' }]}>{label}</Text> : null}
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 3 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }}
              style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: active ? colors.surface : 'transparent' }}>
              <Text numberOfLines={1} style={[font.caption, { fontWeight: '600', color: active ? colors.primary : colors.textMuted }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ChipSelect<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T | null;
  onChange: (v: T) => void;
  label?: string;
}) {
  const { colors, font, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={[font.caption, { color: colors.textMuted, fontWeight: '600' }]}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: active }}
              style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {o.icon ? <Ionicons name={o.icon} size={16} color={active ? colors.primary : colors.textMuted} /> : null}
              <Text style={[font.caption, { fontWeight: '600', color: active ? colors.primary : colors.text }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ListItem({ icon, title, subtitle, right, onPress, accessibilityLabel }: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  right?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors, font, radius } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={accessibilityLabel ?? `${title}. ${subtitle ?? ''} ${right ?? ''}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 }, pressed && { opacity: 0.6 }]}>
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[font.bodyStrong, { color: colors.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[font.caption, { color: colors.textMuted }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ? <Text style={[font.caption, { color: colors.textMuted }]}>{right}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function EmptyState({ icon = 'leaf-outline', title, message, action }: {
  icon?: IconName; title: string; message?: string; action?: { label: string; onPress: () => void };
}) {
  const { colors, font } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
      <Ionicons name={icon} size={36} color={colors.textMuted} />
      <Text style={[font.bodyStrong, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[font.caption, { color: colors.textMuted, textAlign: 'center', maxWidth: 280 }]}>{message}</Text> : null}
      {action ? <Button title={action.label} onPress={action.onPress} variant="secondary" style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { colors, font } = useTheme();
  return (
    <Card accessibilityLabel={`Error: ${error.message}`}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Ionicons name="alert-circle" size={20} color={colors.danger} />
        <Text style={[font.bodyStrong, { color: colors.text }]}>Something went wrong</Text>
      </View>
      <Text style={[font.caption, { color: colors.textMuted }]}>{error.message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center' }} accessibilityLabel="Loading">
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ProgressBar({ value, color, label }: { value: number; color?: string; label?: string }) {
  const { colors, radius } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color ?? colors.primary }} />
    </View>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  const { colors, font, radius } = useTheme();
  const c = tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : colors.info;
  return (
    <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c, backgroundColor: colors.surface }}>
      <Ionicons name={tone === 'info' ? 'information-circle-outline' : 'warning-outline'} size={18} color={c} />
      <Text style={[font.caption, { color: colors.text, flex: 1 }]}>{children}</Text>
    </View>
  );
}

export function KeyValue({ label, value, provenance }: { label: string; value: string; provenance?: Provenance }) {
  const { colors, font } = useTheme();
  return (
    <View style={[styles.rowBetween, { minHeight: 32 }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[font.body, { color: colors.textMuted }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {provenance ? <ProvenanceBadge kind={provenance} /> : null}
        <Text style={[font.bodyStrong, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

export function confirm(title: string, message: string, confirmLabel = 'Delete', destructive = true): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
