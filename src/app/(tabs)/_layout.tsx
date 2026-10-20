import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { useTheme } from '../../ui/theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
const TABS: { name: string; title: string; icon: Icon; iconActive: Icon }[] = [
  { name: 'home', title: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'train', title: 'Train', icon: 'body-outline', iconActive: 'body' },
  { name: 'activities', title: 'Activities', icon: 'walk-outline', iconActive: 'walk' },
  { name: 'cutting', title: 'Cutting', icon: 'nutrition-outline', iconActive: 'nutrition' },
  { name: 'progress', title: 'Progress', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { name: 'profile', title: 'Profile', icon: 'person-outline', iconActive: 'person' },
];

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.title,
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? t.iconActive : t.icon} color={color as string} size={size - 2} />,
          }}
        />
      ))}
    </Tabs>
  );
}
