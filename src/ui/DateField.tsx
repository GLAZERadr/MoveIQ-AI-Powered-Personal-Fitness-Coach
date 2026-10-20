import { Ionicons } from '@expo/vector-icons';
import RNDateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { isLocalDate, parseLocalDate, toLocalDate } from '../domain/dates';
import { MIN_TOUCH, useTheme } from './theme';

/**
 * Native date/time pickers. Values remain strings ('YYYY-MM-DD' / 'HH:MM', or '' when optional and
 * unset) so validation and storage are unchanged. Android uses the system dialog; iOS shows inline.
 */

interface BaseProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  /** Allows clearing back to ''. */
  optional?: boolean;
}

function FieldShell({ label, display, placeholder, icon, onPress, onClear, error, hint }: {
  label: string; display: string | null; placeholder: string; icon: 'calendar-outline' | 'time-outline';
  onPress: () => void; onClear?: () => void; error?: string; hint?: string;
}) {
  const { colors, font, radius } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={[font.caption, { color: colors.textMuted, fontWeight: '600' }]}>{label}</Text>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${display ?? 'not set'}. Double tap to change.`}
        style={({ pressed }) => [{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: error ? colors.danger : colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 }, pressed && { opacity: 0.7 }]}>
        <Ionicons name={icon} size={18} color={colors.textMuted} />
        <Text style={[font.body, { flex: 1, color: display ? colors.text : colors.textMuted }]}>{display ?? placeholder}</Text>
        {onClear && display ? (
          <Pressable onPress={onClear} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Clear ${label}`}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>
      {error ? <Text style={[font.caption, { color: colors.danger }]}>{error}</Text> : hint ? <Text style={[font.caption, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export function DateField({ label, value, onChange, error, hint, optional, minimumDate, maximumDate }: BaseProps & { minimumDate?: Date; maximumDate?: Date }) {
  const [iosOpen, setIosOpen] = useState(false);
  const current = isLocalDate(value) ? parseLocalDate(value) : new Date();
  const display = isLocalDate(value) ? current.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current, mode: 'date', minimumDate, maximumDate,
        onChange: (e, d) => {
          if (e.type === 'set' && d) onChange(toLocalDate(d));
        },
      });
    } else setIosOpen((o) => !o);
  };
  return (
    <View>
      <FieldShell label={label} display={display} placeholder="Choose a date" icon="calendar-outline" onPress={open}
        onClear={optional ? () => onChange('') : undefined} error={error} hint={hint} />
      {Platform.OS === 'ios' && iosOpen ? (
        <RNDateTimePicker value={current} mode="date" display="inline" minimumDate={minimumDate} maximumDate={maximumDate}
          onChange={(_, d) => d && onChange(toLocalDate(d))} />
      ) : null}
    </View>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

export function TimeField({ label, value, onChange, error, hint, optional }: BaseProps) {
  const [iosOpen, setIosOpen] = useState(false);
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const current = new Date();
  if (m) current.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const display = m ? current.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  const set = (d: Date) => onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current, mode: 'time', is24Hour: true,
        onChange: (e, d) => {
          if (e.type === 'set' && d) set(d);
        },
      });
    } else setIosOpen((o) => !o);
  };
  return (
    <View>
      <FieldShell label={label} display={display} placeholder="Add time" icon="time-outline" onPress={open}
        onClear={optional ? () => onChange('') : undefined} error={error} hint={hint} />
      {Platform.OS === 'ios' && iosOpen ? <RNDateTimePicker value={current} mode="time" display="spinner" onChange={(_, d) => d && set(d)} /> : null}
    </View>
  );
}

/** Today at local midnight, as an upper bound for "when did this happen" pickers. */
export const today = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};
