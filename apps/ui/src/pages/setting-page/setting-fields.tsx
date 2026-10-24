import { CircleHelp } from "lucide-react";
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  FormProvider,
  useController,
  useForm,
  useFormContext,
  type UseFormGetValues,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  InfoTip,
  InfoTipContent,
  InfoTipTrigger,
} from "@/components/ui/info-tip";
import { shouldApplyPersistedValue } from "@/services/config-write-coordinator";
import { settingConfigWriter } from "@/services/setting-config-writer";
import { useAppStore } from "@/store/app";
import { cn } from "@/utils";
import type { AppStore } from "@mediago/common";

type Scalar = string | number | boolean;

export type SettingName = {
  [K in keyof AppStore]-?: AppStore[K] extends Scalar ? K : never;
}[keyof AppStore] &
  string;

type SettingValue = AppStore[SettingName];
type BooleanSettingName = {
  [K in SettingName]: AppStore[K] extends boolean ? K : never;
}[SettingName];
type StringSettingName = {
  [K in SettingName]: AppStore[K] extends string ? K : never;
}[SettingName];
type NumberSettingName = {
  [K in SettingName]: AppStore[K] extends number ? K : never;
}[SettingName];

const EDITABLE_SETTING_KEYS = [
  "local",
  "theme",
  "language",
  "promptTone",
  "showTerminal",
  "autoUpgrade",
  "allowBeta",
  "closeMainWindow",
  "enableMobilePlayer",
  "audioMuted",
  "openInNewWindow",
  "proxy",
  "useProxy",
  "blockAds",
  "isMobile",
  "useExtension",
  "privacy",
  "downloadProxySwitch",
  "deleteSegments",
  "maxRunner",
  "apiKey",
  "dockerUrl",
  "enableDocker",
  "enableMcp",
  "mcpToken",
] as const satisfies readonly SettingName[];

type PersistSetting = (name: SettingName, value: SettingValue) => Promise<void>;
type SetSettingDrafting = (name: SettingName, drafting: boolean) => void;

const PersistSettingContext = createContext<PersistSetting | null>(null);
const SettingDraftingContext = createContext<SetSettingDrafting | null>(null);

function getInitialSettings(): AppStore {
  const { setAppStore: _setAppStore, ...settings } = useAppStore.getState();
  return settings;
}

export function SettingsFormProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const setAppStore = useAppStore((state) => state.setAppStore);
  const initialSettings = useRef(getInitialSettings());
  const confirmedSettings = useRef({ ...initialSettings.current });
  const draftingSettings = useRef(new Set<SettingName>());
  const form = useForm<AppStore>({
    defaultValues: initialSettings.current,
    mode: "onBlur",
  });

  const persistSetting = useCallback<PersistSetting>(
    async (name, value) => {
      const isApiKey = name === "apiKey";
      const remoteVersionAtWrite = isApiKey
        ? settingConfigWriter.getRemoteValue(name).version
        : 0;
      const writePromise = settingConfigWriter.enqueue(name, value);
      if (!isApiKey) {
        setAppStore({ [name]: value } as Partial<AppStore>);
      }

      try {
        const persistedValue = await writePromise;
        if (!isApiKey) {
          confirmedSettings.current[name] = persistedValue as never;
        } else {
          const latestRemote = settingConfigWriter.getRemoteValue(name);
          const shouldApplyLocal = shouldApplyPersistedValue(
            remoteVersionAtWrite,
            latestRemote,
            persistedValue,
          );

          if (shouldApplyLocal) {
            confirmedSettings.current[name] = persistedValue as never;
            setAppStore({ apiKey: persistedValue as AppStore["apiKey"] });
          } else if (typeof latestRemote.value === "string") {
            const remoteValue = latestRemote.value;
            confirmedSettings.current[name] = remoteValue as never;
            if (Object.is(form.getValues(name), persistedValue)) {
              form.setValue(name, remoteValue, {
                shouldDirty: false,
                shouldTouch: false,
                shouldValidate: false,
              });
            }
          }
        }
      } catch {
        const pending = settingConfigWriter.getPending(name);
        const hasNewerValue = pending.pending;

        if (!hasNewerValue) {
          const confirmed = confirmedSettings.current[name] as SettingValue;
          if (!isApiKey) {
            const current = useAppStore.getState()[name] as SettingValue;
            if (Object.is(current, value)) {
              setAppStore({ [name]: confirmed } as Partial<AppStore>);
            }
          }
          if (Object.is(form.getValues(name), value)) {
            form.setValue(name, confirmed as never, {
              shouldDirty: false,
              shouldTouch: false,
              shouldValidate: false,
            });
          }
        }

        toast.error(t("settingsSaveFailed"));
      }
    },
    [form, setAppStore, t],
  );

  const setSettingDrafting = useCallback<SetSettingDrafting>(
    (name, drafting) => {
      if (drafting) {
        draftingSettings.current.add(name);
      } else {
        draftingSettings.current.delete(name);
      }
    },
    [],
  );

  useEffect(() => {
    const syncSettings = (
      state: ReturnType<typeof useAppStore.getState>,
      previousState?: ReturnType<typeof useAppStore.getState>,
    ) => {
      EDITABLE_SETTING_KEYS.forEach((name) => {
        const value = state[name];
        if (previousState && Object.is(value, previousState[name])) return;
        if (settingConfigWriter.getPending(name).pending) return;

        confirmedSettings.current[name] = value as never;
        if (draftingSettings.current.has(name)) return;
        if (Object.is(form.getValues(name), value)) return;
        form.setValue(name, value as never, {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      });
    };

    const unsubscribe = useAppStore.subscribe(syncSettings);
    // Close the render-to-subscribe window: a write may have settled after
    // defaultValues were captured but before this effect subscribed.
    syncSettings(useAppStore.getState());

    return unsubscribe;
  }, [form]);

  useEffect(
    () => () => {
      void settingConfigWriter.flush().catch(() => undefined);
    },
    [],
  );

  return (
    <SettingDraftingContext.Provider value={setSettingDrafting}>
      <PersistSettingContext.Provider value={persistSetting}>
        <FormProvider {...form}>
          <TooltipProvider>{children}</TooltipProvider>
        </FormProvider>
      </PersistSettingContext.Provider>
    </SettingDraftingContext.Provider>
  );
}

export function usePersistSetting() {
  const persistSetting = useContext(PersistSettingContext);
  if (!persistSetting) {
    throw new Error(
      "usePersistSetting must be used inside SettingsFormProvider",
    );
  }
  return persistSetting;
}

function useSettingDrafting() {
  const setSettingDrafting = useContext(SettingDraftingContext);
  if (!setSettingDrafting) {
    throw new Error(
      "useSettingDrafting must be used inside SettingsFormProvider",
    );
  }
  return setSettingDrafting;
}

export const SettingCard = memo(function SettingCard({
  title,
  children,
  className,
  headerAction,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}) {
  const titleId = useId();

  return (
    <Card
      aria-labelledby={titleId}
      className={cn(
        "gap-0 overflow-hidden rounded-lg border bg-surface py-0 shadow-none",
        className,
      )}
    >
      <CardHeader className="flex h-14 flex-row items-center gap-3 border-b px-5 py-0 [.border-b]:pb-0">
        <CardTitle
          id={titleId}
          className="min-w-0 flex-1 text-sm font-semibold"
        >
          {title}
        </CardTitle>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </CardHeader>
      <CardContent className="@container/settings flex flex-col px-5 py-0">
        {children}
      </CardContent>
    </Card>
  );
});

function LabelHelp({ content }: { content: ReactNode }) {
  return (
    <InfoTip>
      <InfoTipTrigger
        render={
          <button
            type="button"
            aria-label={String(content)}
            className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        }
      >
        <CircleHelp className="size-4" />
      </InfoTipTrigger>
      <InfoTipContent aria-label={String(content)} sideOffset={6}>
        {content}
      </InfoTipContent>
    </InfoTip>
  );
}

export function SettingRow({
  label,
  htmlFor,
  labelId,
  tooltip,
  error,
  children,
  className,
  contentClassName,
}: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  tooltip?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const generatedLabelId = useId();
  const resolvedLabelId = labelId ?? (htmlFor ? undefined : generatedLabelId);

  return (
    <Field
      aria-labelledby={resolvedLabelId}
      orientation="horizontal"
      data-invalid={Boolean(error)}
      className={cn(
        "grid min-h-14 grid-cols-1 items-start gap-2 py-4 @min-[15rem]/settings:grid-cols-[minmax(112px,0.85fr)_minmax(0,1.15fr)] @min-[15rem]/settings:items-center @min-[15rem]/settings:gap-3 @sm/settings:grid-cols-[minmax(140px,0.85fr)_minmax(180px,1.15fr)] @sm/settings:gap-6",
        className,
      )}
    >
      <div className="flex w-full self-center items-center gap-2">
        {htmlFor ? (
          <FieldLabel htmlFor={htmlFor} className="font-normal">
            {label}
          </FieldLabel>
        ) : (
          <FieldTitle id={resolvedLabelId} className="font-normal">
            {label}
          </FieldTitle>
        )}
        {tooltip ? <LabelHelp content={tooltip} /> : null}
      </div>
      <FieldContent
        className={cn(
          "min-w-0 w-full @min-[15rem]/settings:items-end",
          contentClassName,
        )}
      >
        {children}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldContent>
    </Field>
  );
}

export function SettingSwitchField({
  name,
  label,
  tooltip,
  validate,
}: {
  name: BooleanSettingName;
  label: ReactNode;
  tooltip?: ReactNode;
  validate?: (
    value: boolean,
    getValues: UseFormGetValues<AppStore>,
  ) => string | undefined;
}) {
  const id = `setting-${name}`;
  const persistSetting = usePersistSetting();
  const { control, getValues, setError, clearErrors } =
    useFormContext<AppStore>();
  const { field, fieldState } = useController({ name, control });

  const handleChange = (checked: boolean) => {
    const validationError = validate?.(checked, getValues);
    if (validationError) {
      setError(name, { type: "validate", message: validationError });
      return;
    }
    clearErrors(name);
    field.onChange(checked);
    void persistSetting(name, checked);
  };

  return (
    <SettingRow
      label={label}
      htmlFor={id}
      tooltip={tooltip}
      error={fieldState.error?.message}
    >
      <Switch
        id={id}
        checked={Boolean(field.value)}
        onCheckedChange={handleChange}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid}
      />
    </SettingRow>
  );
}

export function SettingTextField({
  name,
  label,
  tooltip,
  placeholder,
  disabled,
  debounceMs = 400,
  onContextMenu,
  className,
}: {
  name: StringSettingName;
  label: ReactNode;
  tooltip?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  debounceMs?: number;
  onContextMenu?: React.MouseEventHandler<HTMLInputElement>;
  className?: string;
}) {
  const id = `setting-${name}`;
  const persistSetting = usePersistSetting();
  const setSettingDrafting = useSettingDrafting();
  const { control } = useFormContext<AppStore>();
  const { field, fieldState } = useController({ name, control });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pendingValue.current === null) return;
    const value = pendingValue.current;
    pendingValue.current = null;
    const save = persistSetting(name, value);
    setSettingDrafting(name, false);
    void save;
  }, [name, persistSetting, setSettingDrafting]);

  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    field.onChange(value);
    if (disabled) return;
    setSettingDrafting(name, true);
    pendingValue.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, debounceMs);
  };

  return (
    <SettingRow
      label={label}
      htmlFor={id}
      tooltip={tooltip}
      error={fieldState.error?.message}
    >
      <Input
        {...field}
        id={id}
        value={String(field.value ?? "")}
        disabled={disabled}
        placeholder={placeholder}
        onChange={handleChange}
        onBlur={() => {
          field.onBlur();
          flush();
        }}
        onContextMenu={onContextMenu}
        aria-invalid={fieldState.invalid}
        className={cn("h-8", className)}
      />
    </SettingRow>
  );
}

export function SettingSelectField({
  name,
  label,
  tooltip,
  placeholder,
  options,
}: {
  name: StringSettingName;
  label: ReactNode;
  tooltip?: ReactNode;
  placeholder?: string;
  options: Array<{ label: ReactNode; value: string }>;
}) {
  const id = `setting-${name}`;
  const persistSetting = usePersistSetting();
  const { control } = useFormContext<AppStore>();
  const { field, fieldState } = useController({ name, control });

  return (
    <SettingSelectRow
      id={id}
      label={label}
      tooltip={tooltip}
      placeholder={placeholder}
      options={options}
      value={String(field.value)}
      onValueChange={(value) => {
        field.onChange(value);
        void persistSetting(name, value);
      }}
      error={fieldState.error?.message}
    />
  );
}

export function SettingSelectRow({
  id,
  label,
  tooltip,
  placeholder,
  options,
  value,
  onValueChange,
  error,
}: {
  id: string;
  label: ReactNode;
  tooltip?: ReactNode;
  placeholder?: string;
  options: Array<{ label: ReactNode; value: string }>;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
}) {
  return (
    <SettingRow label={label} htmlFor={id} tooltip={tooltip} error={error}>
      <Select items={options} value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

export function SettingBooleanRadioField({
  name,
  label,
  options,
}: {
  name: BooleanSettingName;
  label: ReactNode;
  options: Array<{ label: ReactNode; value: boolean }>;
}) {
  const persistSetting = usePersistSetting();
  const { control } = useFormContext<AppStore>();
  const { field, fieldState } = useController({ name, control });
  const labelId = `setting-${name}-label`;

  return (
    <SettingRow
      label={label}
      labelId={labelId}
      error={fieldState.error?.message}
    >
      <RadioGroup
        aria-labelledby={labelId}
        value={String(Boolean(field.value))}
        onValueChange={(value) => {
          const nextValue = value === "true";
          field.onChange(nextValue);
          void persistSetting(name, nextValue);
        }}
        className="flex flex-wrap justify-end gap-5"
        aria-invalid={fieldState.invalid}
      >
        {options.map((option) => {
          const id = `setting-${name}-${String(option.value)}`;
          return (
            <label
              key={id}
              htmlFor={id}
              className="flex items-center gap-2 text-sm"
            >
              <RadioGroupItem id={id} value={String(option.value)} />
              {option.label}
            </label>
          );
        })}
      </RadioGroup>
    </SettingRow>
  );
}

export function SettingNumberField({
  name,
  label,
  tooltip,
  min,
  max,
}: {
  name: NumberSettingName;
  label: ReactNode;
  tooltip?: ReactNode;
  min: number;
  max: number;
}) {
  const id = `setting-${name}`;
  const persistSetting = usePersistSetting();
  const { control, setError, clearErrors } = useFormContext<AppStore>();
  const { field, fieldState } = useController({ name, control });
  const [draft, setDraft] = useState(String(field.value));
  const editing = useRef(false);
  const draftRef = useRef(String(field.value));
  const fieldValueRef = useRef(Number(field.value));

  useEffect(() => {
    fieldValueRef.current = Number(field.value);
    if (editing.current) return;
    draftRef.current = String(field.value);
    setDraft(String(field.value));
  }, [field.value]);

  const commit = () => {
    editing.current = false;
    field.onBlur();
    const value = Number(draft);
    if (!Number.isInteger(value) || value < min || value > max) {
      setError(name, {
        type: "validate",
        message: `${min}–${max}`,
      });
      setDraft(String(field.value));
      return;
    }
    clearErrors(name);
    field.onChange(value);
    fieldValueRef.current = value;
    void persistSetting(name, value);
  };

  useEffect(
    () => () => {
      if (!editing.current) return;
      const value = Number(draftRef.current);
      if (
        Number.isInteger(value) &&
        value >= min &&
        value <= max &&
        !Object.is(value, fieldValueRef.current)
      ) {
        void persistSetting(name, value);
      }
    },
    [max, min, name, persistSetting],
  );

  return (
    <SettingRow
      label={label}
      htmlFor={id}
      tooltip={tooltip}
      error={fieldState.error?.message}
    >
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={draft}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => {
          const value = event.target.value;
          draftRef.current = value;
          setDraft(value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-invalid={fieldState.invalid}
        className="h-8 max-w-40"
      />
    </SettingRow>
  );
}
