"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  detectPreferredLocale,
  localeMeta,
  translateText,
  type SiteLocale,
} from "@/lib/i18n";

interface LanguageContextValue {
  locale: SiteLocale;
  setLocale: (locale: SiteLocale) => void;
  translate: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

function updateMetadata(locale: SiteLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  document.title = localeMeta[locale].title;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = localeMeta[locale].description;
}

function skippedElement(element: Element | null) {
  if (!element) return false;
  if (SKIP_TAGS.has(element.tagName)) return true;
  return Boolean(element.closest("[data-i18n-ignore='true']"));
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SiteLocale>("es");
  const textSources = useRef(new WeakMap<Text, string>());
  const attributeSources = useRef(new WeakMap<Element, Map<string, string>>());

  const setLocale = useCallback((next: SiteLocale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") window.localStorage.setItem("rdsismos-language", next);
  }, []);

  const translate = useCallback((text: string) => translateText(text, locale), [locale]);

  useEffect(() => {
    setLocaleState(detectPreferredLocale());
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    updateMetadata(locale);

    const renderTextNode = (node: Text) => {
      if (skippedElement(node.parentElement)) return;
      const current = node.nodeValue ?? "";
      const previousSource = textSources.current.get(node);
      const previousRendered = previousSource === undefined ? undefined : translateText(previousSource, locale);
      const source = previousSource === undefined || (current !== previousRendered && current !== previousSource)
        ? current
        : previousSource;
      textSources.current.set(node, source);
      const translated = translateText(source, locale);
      if (translated !== current) node.nodeValue = translated;
    };

    const renderAttributes = (element: Element) => {
      if (skippedElement(element)) return;
      let stored = attributeSources.current.get(element);
      if (!stored) {
        stored = new Map<string, string>();
        attributeSources.current.set(element, stored);
      }
      for (const attribute of TRANSLATABLE_ATTRIBUTES) {
        const current = element.getAttribute(attribute);
        if (current === null) continue;
        const previousSource = stored.get(attribute);
        const previousRendered = previousSource === undefined ? undefined : translateText(previousSource, locale);
        const source = previousSource === undefined || (current !== previousRendered && current !== previousSource)
          ? current
          : previousSource;
        stored.set(attribute, source);
        const translated = translateText(source, locale);
        if (translated !== current) element.setAttribute(attribute, translated);
      }
    };

    const renderSubtree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        renderTextNode(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (root instanceof Element) {
        if (skippedElement(root)) return;
        renderAttributes(root);
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) renderTextNode(current as Text);
        else if (current instanceof Element) renderAttributes(current);
        current = walker.nextNode();
      }
    };

    let observer: MutationObserver;
    const observe = () => observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });

    observer = new MutationObserver((mutations) => {
      observer.disconnect();
      for (const mutation of mutations) {
        if (mutation.type === "characterData") renderSubtree(mutation.target);
        if (mutation.type === "attributes") renderAttributes(mutation.target as Element);
        for (const node of mutation.addedNodes) renderSubtree(node);
      }
      observe();
    });

    renderSubtree(document.body);
    observe();
    return () => observer.disconnect();
  }, [locale]);

  const value = useMemo<LanguageContextValue>(() => ({ locale, setLocale, translate }), [locale, setLocale, translate]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
