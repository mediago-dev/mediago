import signinBG from "@/assets/images/signin-bg-v2.png";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthApi } from "@/hooks/use-auth-api";
import { useMemoizedFn } from "ahooks";
import { useNavigate } from "react-router-dom";
import { setAppStoreSelector, useAppStore } from "@/store/app";
import { useShallow } from "zustand/react/shallow";

export default function SigninPage() {
  const { isSetuped, setupTokenRequired, isLoading, error, setupAuth, signin } =
    useAuthApi();
  const [submitting, setSubmitting] = useState(false);
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleSubmit = useMemoizedFn(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || isLoading || error) return;
      setSubmitting(true);

      try {
        const formData = new FormData(e.currentTarget);
        const password = formData.get("password") as string;

        let apiKey: string;
        if (isSetuped) {
          apiKey = await signin(password);
        } else {
          const repeatPassword = formData.get("repeat-password") as string;

          if (password !== repeatPassword) {
            alert(t("passwordNotMatch"));
            return;
          }

          apiKey = await setupAuth(
            password,
            (formData.get("setup-token") as string | null)?.trim(),
          );
        }

        setAppStore({ apiKey });

        navigate("/");
      } catch {
        alert(t(isSetuped ? "signinFailed" : "setupFailed"));
      } finally {
        setSubmitting(false);
      }
    },
  );

  return (
    <div className="flex h-full items-center justify-center overflow-hidden bg-canvas px-8 py-6 max-lg:p-0">
      <div className="grid h-full max-h-[780px] w-full max-w-[1320px] grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] max-lg:max-h-none">
        <div className="flex h-full min-w-0 flex-col justify-center overflow-hidden rounded-2xl border bg-surface px-4 py-12 shadow-sm sm:px-6 lg:px-12 xl:px-16 max-lg:rounded-none max-lg:border-0 max-lg:shadow-none">
          <div className="mx-auto w-full max-w-sm">
            <div>
              <h2 className="mt-8 text-2xl/9 font-bold tracking-tight text-gray-900 dark:text-white">
                {isSetuped
                  ? t("signinMediaGoServer")
                  : t("initializeMediaGoServer")}
              </h2>
            </div>

            <div className="mt-10">
              <div>
                <form
                  action="#"
                  method="POST"
                  className="space-y-6"
                  onSubmit={handleSubmit}
                >
                  {!isSetuped && setupTokenRequired && (
                    <div>
                      <label
                        htmlFor="setup-token"
                        className="block text-sm/6 font-medium text-foreground"
                      >
                        {t("setupToken")}
                      </label>
                      <Input
                        id="setup-token"
                        name="setup-token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={128}
                        required
                        aria-describedby="setup-token-help"
                        className="mt-2"
                      />
                      <p
                        id="setup-token-help"
                        className="mt-2 text-sm text-muted-foreground"
                      >
                        {t("setupTokenHelp")}
                      </p>
                    </div>
                  )}
                  <div>
                    <label
                      htmlFor="password"
                      className="block text-sm/6 font-medium text-foreground"
                    >
                      {isSetuped
                        ? t("adminPassword")
                        : t("settingUpAdminPassword")}
                    </label>
                    <div className="mt-2">
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        minLength={6}
                        required
                      />
                    </div>
                  </div>

                  {!isSetuped && (
                    <div>
                      <label
                        htmlFor="repeat-password"
                        className="block text-sm/6 font-medium text-foreground"
                      >
                        {t("repeatPassword")}
                      </label>
                      <div className="mt-2">
                        <Input
                          id="repeat-password"
                          name="repeat-password"
                          type="password"
                          minLength={6}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {isSetuped && (
                    <div className="flex items-center justify-end">
                      <div className="text-sm/6">
                        <Dialog>
                          <DialogTrigger className="cursor-pointer">
                            {t("forgotPassword")}
                          </DialogTrigger>
                          <DialogContent className="w-sm">
                            <DialogHeader>
                              <DialogTitle>{t("forgotPassword")}</DialogTitle>
                            </DialogHeader>
                            <div className="text-gray-600 text-sm whitespace-pre-line dark:text-gray-300 leading-6">
                              {t("forgetPasswordDescription")}
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  )}

                  <div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={submitting || isLoading || Boolean(error)}
                    >
                      {isSetuped ? t("signin") : t("setup")}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
        <div className="relative hidden h-full min-w-0 overflow-hidden rounded-2xl border bg-surface shadow-sm lg:block">
          <img
            alt=""
            src={signinBG}
            className="absolute inset-0 size-full object-cover"
          />
        </div>
      </div>
    </div>
  );
}
