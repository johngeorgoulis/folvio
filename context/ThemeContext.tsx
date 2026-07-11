import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { minimalLight, minimalDark, type MinimalTheme } from "@/constants/colors";

const STORAGE_KEY = "folvio_minimal_dark_mode";

type ThemeContextValue = {
  theme: MinimalTheme;
  isDark: boolean;
  setIsDark: (val: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: minimalLight,
  isDark: false,
  setIsDark: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDarkState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "true") setIsDarkState(true);
    });
  }, []);

  function setIsDark(val: boolean) {
    setIsDarkState(val);
    AsyncStorage.setItem(STORAGE_KEY, val ? "true" : "false");
  }

  return (
    <ThemeContext.Provider value={{ theme: isDark ? minimalDark : minimalLight, isDark, setIsDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
