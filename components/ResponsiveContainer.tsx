import React from "react";
import { View, ViewProps, StyleProp, ViewStyle } from "react-native";
import { useIsTablet } from "../hooks/useResponsive";
import { CONTENT_MAX_WIDTH } from "../constants/layout";

interface ResponsiveContainerProps extends ViewProps {
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function ResponsiveContainer({
  children,
  style,
  maxWidth = CONTENT_MAX_WIDTH,
  ...rest
}: ResponsiveContainerProps) {
  const isTablet = useIsTablet();

  return (
    <View
      style={[
        isTablet && { maxWidth, alignSelf: "center", width: "100%" },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
