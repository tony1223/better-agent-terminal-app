/**
 * RootNavigator - Main navigation structure
 *
 * ConnectScreen (when disconnected)
 * MainTabs (when connected)
 *   ├─ WorkspacesStack
 *   │    └─ WorkspaceListScreen
 *   ├─ TerminalsStack
 *   │    ├─ TerminalListScreen
 *   │    ├─ TerminalScreen
 *   │    └─ ClaudeScreen
 *   └─ SettingsScreen
 * AddHostScreen (modal)
 */

import React from 'react'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Text, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, fontSize } from '@/theme/colors'

// Screens
import { ConnectScreen } from '@/screens/ConnectScreen'
import { AddHostScreen } from '@/screens/AddHostScreen'
import { WorkspaceListScreen } from '@/screens/WorkspaceListScreen'
import { TerminalListScreen } from '@/screens/TerminalListScreen'
import { TerminalScreen } from '@/screens/TerminalScreen'
import { ClaudeScreen } from '@/screens/ClaudeScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { ScanQRScreen } from '@/screens/ScanQRScreen'

// Dialogs (rendered as overlays in App.tsx, not in navigation)

// ---- Param types ----

export type RootStackParamList = {
  Connect: undefined
  AddHost: undefined
  ScanQR: undefined
  Main: undefined
}

export type TerminalsStackParamList = {
  TerminalList: undefined
  Terminal: { terminalId: string }
  Claude: { sessionId: string }
}

// ---- Navigators ----

const RootStack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator()
const TerminalsNav = createNativeStackNavigator<TerminalsStackParamList>()
const WorkspacesNav = createNativeStackNavigator()

// ---- Tab icon component ----

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Workspaces: '\u2302', // ⌂
    Terminals: '>_',
    Settings: '\u2699', // ⚙
  }
  return (
    <Text style={[styles.tabIcon, focused && styles.tabIconFocused]}>
      {icons[label] || '?'}
    </Text>
  )
}

// ---- Stack navigators ----

function WorkspacesStack() {
  return (
    <WorkspacesNav.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: appColors.surface },
        headerTintColor: appColors.text,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <WorkspacesNav.Screen
        name="WorkspaceList"
        component={WorkspaceListScreen}
        options={{ title: 'Workspaces' }}
      />
    </WorkspacesNav.Navigator>
  )
}

function TerminalsStack() {
  return (
    <TerminalsNav.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: appColors.surface },
        headerTintColor: appColors.text,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <TerminalsNav.Screen
        name="TerminalList"
        component={TerminalListScreen}
        options={{ title: 'Terminals' }}
      />
      <TerminalsNav.Screen
        name="Terminal"
        component={TerminalScreen}
        options={({ route }) => ({
          title: 'Terminal',
          headerShown: false,
        })}
      />
      <TerminalsNav.Screen
        name="Claude"
        component={ClaudeScreen}
        options={{ title: 'Claude' }}
      />
    </TerminalsNav.Navigator>
  )
}

// ---- Main Tabs ----

function MainTabs() {
  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: 0 }}
      detachInactiveScreens={false}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: appColors.surface,
          borderTopColor: appColors.border,
          marginTop: -28,
        },
        tabBarActiveTintColor: appColors.accent,
        tabBarInactiveTintColor: appColors.textSecondary,
        tabBarIcon: ({ focused }) => (
          <TabIcon label={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Workspaces" component={WorkspacesStack} />
      <Tab.Screen name="Terminals" component={TerminalsStack} />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: appColors.surface },
          headerTintColor: appColors.text,
        }}
      />
    </Tab.Navigator>
  )
}

// ---- Navigation theme ----

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: appColors.background,
    card: appColors.surface,
    border: appColors.border,
    text: appColors.text,
    primary: appColors.accent,
  },
}

// ---- Root ----

export function RootNavigator() {
  const status = useConnectionStore(s => s.status)
  const isConnected = status === 'connected'

  return (
    <NavigationContainer theme={navTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isConnected ? (
          <RootStack.Screen name="Main" component={MainTabs} />
        ) : (
          <RootStack.Screen name="Connect" component={ConnectScreen} />
        )}
        <RootStack.Screen
          name="AddHost"
          component={AddHostScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            title: 'Add Host',
            headerStyle: { backgroundColor: appColors.surface },
            headerTintColor: appColors.text,
          }}
        />
        <RootStack.Screen
          name="ScanQR"
          component={ScanQRScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            title: 'Scan QR Code',
            headerStyle: { backgroundColor: '#000' },
            headerTintColor: appColors.text,
          }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: fontSize.lg,
    color: appColors.textSecondary,
  },
  tabIconFocused: {
    color: appColors.accent,
  },
})
