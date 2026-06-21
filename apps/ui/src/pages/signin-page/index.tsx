import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMemoizedFn } from "ahooks";
import { useNavigate } from "react-router-dom";
import { Download } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MgButton, MgCard } from "@/components/mg";
import { useAuthApi } from "@/hooks/use-auth-api";
import { setAppStoreSelector, useAppStore } from "@/store/app";

type Mode = "init" | "signin";

const inputClassName =
  "h-[46px] w-full rounded-[12px] border-[1.5px] border-mg-line bg-mg-surface2 px-[14px] text-[15px] tracking-[0.1em] text-mg-fg outline-none transition-colors placeholder:tracking-[0.1em] placeholder:text-mg-fg3 focus:border-mg-primary focus:bg-mg-surface";

const labelClassName = "mb-[7px] block text-[12.5px] font-bold text-mg-fg2";

export default function SigninPage() {
  const { isSetuped, setupAuth, signin } = useAuthApi();
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Local mode seeded from server status, toggleable via the footer link.
  const [mode, setMode] = useState<Mode>(isSetuped ? "signin" : "init");
  const [error, setError] = useState("");

  // Keep mode in sync once the server status resolves (unless the user already
  // toggled away — we only re-seed while no error/interaction has happened).
  useEffect(() => {
    setMode(isSetuped ? "signin" : "init");
  }, [isSetuped]);

  const isInit = mode === "init";

  const copy = useMemo(
    () => ({
      title: isInit ? t("initializeMediaGoServer") : t("signinMediaGoServer"),
      subtitle: isInit ? t("settingUpAdminPassword") : t("adminPassword"),
      submit: isInit ? t("setup") : t("signin"),
      switch: isInit ? t("signin") : t("setup"),
    }),
    [isInit, t],
  );

  const toggleMode = useMemoizedFn(() => {
    setError("");
    setMode((m) => (m === "init" ? "signin" : "init"));
  });

  const handleSubmit = useMemoizedFn(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError("");

      const formData = new FormData(e.currentTarget);
      const password = formData.get("password") as string;

      try {
        let apiKey: string;
        if (isInit) {
          const repeatPassword = formData.get("repeat-password") as string;
          if (password !== repeatPassword) {
            setError(t("passwordNotMatch"));
            return;
          }
          apiKey = await setupAuth(password);
        } else {
          apiKey = await signin(password);
        }

        setAppStore({ apiKey });
        navigate("/");
      } catch {
        setError(t("signinFailed"));
      }
    },
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center overflow-auto bg-mg-bg p-6">
      <div className="w-[min(420px,100%)]">
        <div className="mb-[26px] flex flex-col items-center">
          <div className="mb-4 flex size-[62px] items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,var(--mg-primary),#9b6bff)] shadow-[0_12px_30px_-8px_rgba(91,91,245,.6)]">
            <Download size={32} strokeWidth={2.4} className="text-white" />
          </div>
          <h1 className="m-0 text-[23px] font-extrabold tracking-[-0.02em] text-mg-fg">
            {copy.title}
          </h1>
          <p className="mt-[7px] text-center text-[13.5px] text-mg-fg2">
            {copy.subtitle}
          </p>
        </div>

        <MgCard className="rounded-[20px] p-6 shadow-[0_18px_50px_-22px_var(--mg-shadow)]">
          <form className="flex flex-col gap-[15px]" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="password" className={labelClassName}>
                {t("adminPassword")}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                minLength={6}
                required
                autoComplete={isInit ? "new-password" : "current-password"}
                placeholder="••••••••"
                className={inputClassName}
              />
            </div>

            {isInit && (
              <div>
                <label htmlFor="repeat-password" className={labelClassName}>
                  {t("repeatPassword")}
                </label>
                <input
                  id="repeat-password"
                  name="repeat-password"
                  type="password"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className={inputClassName}
                />
              </div>
            )}

            {error && (
              <p className="m-0 text-[12.5px] font-semibold text-mg-failed">
                {error}
              </p>
            )}

            <MgButton
              type="submit"
              variant="primary"
              className="mt-1 h-[48px] w-full rounded-[13px] text-[15px]"
            >
              {copy.submit}
            </MgButton>

            <div className="flex items-center justify-between text-[12px]">
              <button
                type="button"
                onClick={toggleMode}
                className="cursor-pointer border-none bg-transparent p-0 font-semibold text-mg-primary"
              >
                {copy.switch}
              </button>

              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer border-none bg-transparent p-0 text-mg-fg3 transition-colors hover:text-mg-fg2"
                  >
                    {t("forgotPassword")}
                  </button>
                </DialogTrigger>
                <DialogContent className="w-sm">
                  <DialogHeader>
                    <DialogTitle>{t("forgotPassword")}</DialogTitle>
                  </DialogHeader>
                  <div className="whitespace-pre-line text-[13px] leading-6 text-mg-fg2">
                    {t("forgetPasswordDescription")}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </form>
        </MgCard>
      </div>
    </div>
  );
}
