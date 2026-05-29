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
import { Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, fontSize } from '@/theme/colors'
import { MAIN_TAB_BAR_STYLE } from '@/navigation/tabBarStyle'

// Screens
import { ConnectScreen } from '@/screens/ConnectScreen'
import { AddHostScreen } from '@/screens/AddHostScreen'
import { WorkspaceListScreen } from '@/screens/WorkspaceListScreen'
import { WorkspaceDetailScreen } from '@/screens/WorkspaceDetailScreen'
import { TerminalListScreen } from '@/screens/TerminalListScreen'
import { TerminalScreen } from '@/screens/TerminalScreen'
import { ClaudeScreen } from '@/screens/ClaudeScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { ScanQRScreen } from '@/screens/ScanQRScreen'
import { LocalSettingsScreen } from '@/screens/LocalSettingsScreen'

// Dialogs (rendered as overlays in App.tsx, not in navigation)

// ---- Param types ----

export type RootStackParamList = {
  Connect: undefined
  AddHost: undefined
  ScanQR: undefined
  LocalSettings: undefined
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
  const { t } = useTranslation()
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
        options={{ title: t('nav.workspaces') }}
      />
      <WorkspacesNav.Screen
        name="WorkspaceDetail"
        component={WorkspaceDetailScreen}
        options={{ title: t('nav.workspace') }}
      />
    </WorkspacesNav.Navigator>
  )
}

function TerminalsStack() {
  const { t } = useTranslation()
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
        options={{ title: t('nav.terminals') }}
      />
      <TerminalsNav.Screen
        name="Terminal"
        component={TerminalScreen}
        options={() => ({
          title: t('nav.terminal'),
          headerShown: true,
        })}
      />
      <TerminalsNav.Screen
        name="Claude"
        component={ClaudeScreen}
        options={{ title: t('nav.claude') }}
      />
    </TerminalsNav.Navigator>
  )
}

// ---- Main Tabs ----

function MainTabs() {
  const { t } = useTranslation()
  return (
    <Tab.Navigator
      detachInactiveScreens={false}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: MAIN_TAB_BAR_STYLE,
        tabBarActiveTintColor: appColors.accent,
        tabBarInactiveTintColor: appColors.textSecondary,
        tabBarIcon: ({ focused }) => (
          <TabIcon label={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen
        name="Workspaces"
        component={WorkspacesStack}
        options={{ tabBarLabel: t('nav.workspaces') }}
      />
      <Tab.Screen
        name="Terminals"
        component={TerminalsStack}
        options={{ tabBarLabel: t('nav.terminals') }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: true,
          title: t('nav.settings'),
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
  const { t } = useTranslation()
  const status = useConnectionStore(s => s.status)
  const isConnected = status === 'connected'

  return (
    <NavigationContainer theme={navTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isConnected ? (
          <RootStack.Screen name="Main" component={MainTabs} />
        ) : (
          <RootStack.Screen
            name="Connect"
            component={ConnectScreen}
            options={{ animationTypeForReplace: 'pop' }}
          />
        )}
        <RootStack.Screen
          name="AddHost"
          component={AddHostScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('nav.addHost'),
            headerStyle: { backgroundColor: appColors.surface },
            headerTintColor: appColors.text,
          }}
        />
        <RootStack.Screen
          name="LocalSettings"
          component={LocalSettingsScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('nav.settings'),
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
            title: t('nav.scanQR'),
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
