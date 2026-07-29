import { BaseTab } from "@components/tabs/tabsReducer";
import { NwbObjectViewPlugin } from "./plugins/pluginInterface";
import { findPluginByName } from "./plugins/registry";

type MainTab = BaseTab & {
  type: "main";
};

export type SingleObjectTab = BaseTab & {
  type: "single";
  path: string;
  objectType: "group" | "dataset";
  plugin?: NwbObjectViewPlugin;
  secondaryPaths?: string[];
};

type MultiObjectTab = BaseTab & {
  type: "multi";
  paths: string[];
  objectTypes: ("group" | "dataset")[];
  plugins: (NwbObjectViewPlugin | undefined)[];
  secondaryPathsList: (string[] | undefined)[];
};

export type DynamicTab = MainTab | SingleObjectTab | MultiObjectTab;

type TabsAction =
  | {
      type: "OPEN_TAB";
      id: string;
      path: string;
      objectType: "group" | "dataset";
      plugin?: NwbObjectViewPlugin;
      secondaryPaths?: string[];
    }
  | {
      type: "OPEN_MULTI_TAB";
      paths: string[];
      objectTypes: ("group" | "dataset")[];
    }
  | { type: "CLOSE_TAB"; id: string }
  | { type: "SWITCH_TO_TAB"; id: string };

export type TabsState = {
  tabs: DynamicTab[];
  activeTabId: string;
};

const generateMultiTabId = (paths: string[]) => {
  return JSON.stringify(paths);
};

const tabsReducer = (state: TabsState, action: TabsAction): TabsState => {
  switch (action.type) {
    case "OPEN_MULTI_TAB": {
      if (!action.paths.length) return state;

      const id = generateMultiTabId(action.paths);

      // Check if tab with same paths already exists
      const existingTab = state.tabs.find((tab) => tab.id === id);
      if (existingTab) {
        return {
          ...state,
          activeTabId: existingTab.id,
        };
      }

      const { paths, plugins, secondaryPathsList } = getPathsAndPlugins(
        action.paths,
      );

      const newTab: MultiObjectTab = {
        id,
        type: "multi",
        label: `${action.paths.length} items`,
        paths,
        plugins,
        secondaryPathsList,
        objectTypes: action.objectTypes,
      };

      return {
        tabs: [...state.tabs, newTab],
        activeTabId: id,
      };
    }

    case "OPEN_TAB": {
      const id = action.id;
      // Check if tab with same path already exists
      const existingTab = state.tabs.find((tab) => tab.id === id);
      if (existingTab) {
        return {
          ...state,
          activeTabId: existingTab.id,
        };
      }

      const label = action.path.split("/").pop() || "Untitled";
      const newTab: SingleObjectTab = {
        id,
        type: "single",
        label,
        path: action.path,
        objectType: action.objectType,
        plugin: action.plugin,
        secondaryPaths: action.secondaryPaths,
      };

      return {
        tabs: [...state.tabs, newTab],
        activeTabId: id,
      };
    }

    case "SWITCH_TO_TAB": {
      return {
        ...state,
        activeTabId: action.id,
      };
    }

    case "CLOSE_TAB": {
      const newTabs = state.tabs.filter((tab) => tab.id !== action.id);
      return {
        tabs: newTabs,
        // If closing active tab, activate the last tab or main if no tabs remain
        activeTabId:
          state.activeTabId === action.id
            ? newTabs.length > 0
              ? newTabs[newTabs.length - 1].id
              : "widgets"
            : state.activeTabId,
      };
    }

    default:
      return state;
  }
};

// Parse a selection string. A plain object selection is just its path; a
// plugin/launch selection is "<pluginName>|<path>[^<secondaryPath>...]".
export const parseSelectionItem = (
  itemString: string,
): { path: string; pluginName?: string; secondaryPaths: string[] } => {
  const a = itemString.split("|");
  if (a.length <= 1) {
    return { path: itemString, secondaryPaths: [] };
  }
  const b = a[1].split("^");
  return { path: b[0], pluginName: a[0], secondaryPaths: b.slice(1) };
};

const getPathsAndPlugins = (itemStrings: string[]) => {
  const paths: string[] = [];
  const plugins: (NwbObjectViewPlugin | undefined)[] = [];
  const secondaryPathsList: (string[] | undefined)[] = [];
  // Push to every array on each iteration so the four stay index-aligned.
  for (const itemString of itemStrings) {
    const { path, pluginName, secondaryPaths } = parseSelectionItem(itemString);
    paths.push(path);
    plugins.push(pluginName ? findPluginByName(pluginName) : undefined);
    secondaryPathsList.push(pluginName ? secondaryPaths : undefined);
  }
  return { paths, plugins, secondaryPathsList };
};

export default tabsReducer;
