import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DbProvider } from '../data/DbProvider';
// Registers the background GPS task at startup (required for recording with the screen off).
import '../gps/recorder';
import { Button, Loading } from '../ui/components';
import { useTheme } from '../ui/theme';

function Boot() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <Loading />
    </View>
  );
}

function BootError({ error, retry }: { error: Error; retry: () => void }) {
  const { colors, font } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={[font.title, { color: colors.text }]}>Could not open your data</Text>
      <Text style={[font.body, { color: colors.textMuted }]}>{error.message}</Text>
      <Button title="Try again" onPress={retry} />
    </View>
  );
}

export default function RootLayout() {
  const { colors, dark } = useTheme();
  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <DbProvider fallback={<Boot />} errorView={(e, retry) => <BootError error={e} retry={retry} />}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            headerBackTitle: 'Back',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="workout/live" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="workout/setup" options={{ title: 'Workout setup' }} />
          <Stack.Screen name="workout/[id]" options={{ title: 'Workout report' }} />
          <Stack.Screen name="run/edit" options={{ title: 'Run', presentation: 'modal' }} />
          <Stack.Screen name="run/[id]" options={{ title: 'Run' }} />
          <Stack.Screen name="run/record" options={{ title: 'Record run' }} />
          <Stack.Screen name="swim/edit" options={{ title: 'Swim', presentation: 'modal' }} />
          <Stack.Screen name="swim/[id]" options={{ title: 'Swim' }} />
          <Stack.Screen name="weight/edit" options={{ title: 'Body weight', presentation: 'modal' }} />
          <Stack.Screen name="measurement/edit" options={{ title: 'Measurement', presentation: 'modal' }} />
          <Stack.Screen name="food/edit" options={{ title: 'Log food', presentation: 'modal' }} />
          <Stack.Screen name="goal" options={{ title: 'Goal & targets' }} />
          <Stack.Screen name="share" options={{ title: 'Share', presentation: 'modal' }} />
        </Stack>
      </DbProvider>
    </SafeAreaProvider>
  );
}
