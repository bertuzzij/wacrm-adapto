'use client';

// ============================================================
// Redefinição de senha por um owner, para um membro da conta.
//
// POR QUE ISTO EXISTE: o email de reset do Supabase aponta para o Site URL
// configurado no painel; com a configuração errada, o link cai em
// localhost e o membro fica travado. Este caminho redefine a senha direto
// no auth.users (via /api/admin/users/password), sem email e sem painel.
//
// O fluxo oficial NÃO é substituído: o membro continua podendo trocar a
// própria senha por updateUser quando logado, e o email de reset volta a
// funcionar quando o Site URL do Supabase for corrigido.
//
// Segurança: ação visível apenas para owner, com confirmação dupla
// (diálogo digitando o nome? — não: diálogo simples com consequência
// explícita, pois o efeito — deslogar o membro — é reversível pelo
// próprio membro re-logando).
// ============================================================

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validatePassword } from '@/adapto/admin-password/rules';

export interface ResetTarget {
  user_id: string;
  full_name: string;
  email: string | null;
}

export function ResetPasswordDialog({
  target,
  onClose,
  onDone,
}: {
  target: ResetTarget;
  onClose: () => void;
  /** Chamado após sucesso — o pai recarrega a lista se quiser. */
  onDone: () => void;
}) {
  const t = useTranslations('Settings.adminPassword');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const email = target.email ?? '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const check = validatePassword(password, confirm);
    if (!check.ok) {
      setError(
        check.error === 'too-short' ? t('passwordTooShort')
        : check.error === 'mismatch' ? t('passwordsMismatch')
        : t('passwordRequired')
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/users/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, confirmPassword: confirm }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || t('failed'));
        return;
      }
      toast.success(t('successToast', { name: target.full_name || email }));
      onDone();
      onClose();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <KeyRound className="h-4 w-4 text-primary" />
            {t('title', { name: target.full_name || email })}
          </DialogTitle>
          <DialogDescription>
            {t('desc', { email })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-new-password" className="text-muted-foreground">
              {t('passwordLabel')}
            </Label>
            <Input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-confirm-password" className="text-muted-foreground">
              {t('confirmLabel')}
            </Label>
            <Input
              id="admin-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="border-border bg-muted text-foreground"
            />
          </div>

          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            {t('warning')}
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
