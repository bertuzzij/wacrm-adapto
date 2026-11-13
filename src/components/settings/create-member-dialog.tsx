'use client';

// ============================================================
// Criar membro com senha temporária — substitui o convite por link.
//
// Por que substituiu: o convite dependia de email entregue (link para o
// Site URL do Supabase; com a configuração errada, o link caía em
// localhost). Aqui o owner define email + senha temporária e o membro
// entra direto — sem email, sem confirmação.
//
// A senha é TEMPORÁRIA por convenção do fluxo: o owner passa por um canal
// seguro e o membro troca por updateUser assim que entra (fluxo oficial,
// intacto). O diálogo sugere uma senha forte gerada localmente.
// ============================================================

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isValidEmail, validatePassword } from '@/adapto/admin-password/rules';

/** Papéis criáveis — owner nunca (uma conta tem um dono). */
const CREATABLE_ROLES = [
  { value: 'admin' },
  { value: 'agent' },
  { value: 'viewer' },
] as const;

type CreatableRole = (typeof CREATABLE_ROLES)[number]['value'];

/** Gera senha temporária legível: AAAA-nnnn (14+ chars efetivos?). Simples e forte o bastante para o primeiro login. */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I/O para não confundir na leitura
  const digits = '23456789'; // sem 0/1
  const pick = (set: string, n: number) =>
    Array.from(
      { length: n },
      () => set[Math.floor(Math.random() * set.length)]
    ).join('');
  return `${pick(alphabet, 4)}${pick(digits, 4)}${pick(alphabet, 4)}${pick(digits, 4)}`;
}

export function CreateMemberDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('Settings.createMember');
  const tRoles = useTranslations('Settings.roles');

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<CreatableRole>('agent');
  const [password, setPassword] = useState(() => generateTempPassword());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const passwordCheck = useMemo(
    () => validatePassword(password),
    [password]
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError(t('invalidEmail'));
      return;
    }
    if (!passwordCheck.ok) {
      setError(t('passwordTooShort'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role, fullName }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || t('createFailed'));
        return;
      }
      toast.success(t('createdToast', { email }));
      onCreated();
      onClose();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('title')}</DialogTitle>
          <DialogDescription>
            {t('desc')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-name" className="text-muted-foreground">
              {t('nameLabel')}
            </Label>
            <Input
              id="cm-name"
              type="text"
              autoComplete="off"
              placeholder={t('namePlaceholder')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-email" className="text-muted-foreground">
              {t('emailLabel')}
            </Label>
            <Input
              id="cm-email"
              type="email"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-role" className="text-muted-foreground">
              {t('roleLabel')}
            </Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as CreatableRole)}>
              <SelectTrigger id="cm-role" className="border-border bg-muted text-foreground">
                <SelectValue>{tRoles(role)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {tRoles(r.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-password" className="text-muted-foreground">
              {t('passwordLabel')}
            </Label>
            <div className="flex gap-2">
              <Input
                id="cm-password"
                type="text"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setPassword(generateTempPassword())}
                className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('regenerate')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
          </div>

          <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-foreground">
            {t('deliveryHint')}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
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
