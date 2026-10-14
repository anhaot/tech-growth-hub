import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Braces, CheckCircle2, Eye, EyeOff, Lock, RefreshCw, ShieldCheck, Sparkles, User } from 'lucide-react';
import { adminApi, authApi } from '@/api';
import { useAuthStore } from '@/store';

const generateCaptcha = (): { text: string; svg: string } => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let text = '';
  for (let i = 0; i < 4; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48" viewBox="0 0 120 48">';
  svg += '<rect width="120" height="48" rx="10" fill="#f8fafc"/>';

  for (let i = 0; i < 24; i += 1) {
    const x = Math.random() * 120;
    const y = Math.random() * 48;
    const color = colors[Math.floor(Math.random() * colors.length)];
    svg += `<circle cx="${x}" cy="${y}" r="1.5" fill="${color}" opacity="0.18"/>`;
  }

  for (let i = 0; i < text.length; i += 1) {
    const x = 18 + i * 24;
    const y = 30 + Math.random() * 6 - 3;
    const rotation = Math.random() * 20 - 10;
    const color = colors[Math.floor(Math.random() * colors.length)];
    svg += `<text x="${x}" y="${y}" font-family="Georgia, serif" font-size="22" font-weight="700" fill="${color}" transform="rotate(${rotation} ${x} ${y})">${text[i]}</text>`;
  }

  svg += '</svg>';
  return { text, svg };
};

const AuthShell: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, children, footer }) => (
  <div className="relative min-h-screen overflow-hidden bg-[#f5f7fb] p-3 sm:p-6 lg:flex lg:items-center lg:justify-center">
    <div className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-blue-200/45 blur-3xl" />
    <div className="relative mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-[1380px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(38,62,105,0.14)] sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[44%_56%]">
      <main className="order-2 flex min-h-full flex-col bg-white px-6 py-7 sm:px-12 sm:py-10 lg:order-1 lg:px-16 xl:px-24">
        <div className="flex items-center gap-3 text-slate-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <div className="text-base font-semibold tracking-tight">技术成长站</div>
            <div className="mt-0.5 text-[11px] tracking-[0.16em] text-slate-400">TECH GROWTH HUB</div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">
            <div className="mb-8">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                安全访问
              </div>
              <h1 className="text-[2rem] font-semibold tracking-tight text-slate-950">{title}</h1>
              {subtitle ? <p className="mt-3 text-sm leading-6 text-slate-500">{subtitle}</p> : null}
            </div>
            {children}
            {footer ? <div className="mt-7 border-t border-slate-100 pt-6">{footer}</div> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>© 2026 技术成长站</span>
          <span>题库 · 记录 · 学习</span>
        </div>
      </main>

      <aside className="relative order-1 hidden overflow-hidden bg-gradient-to-br from-[#3977f6] via-[#2864ed] to-[#1749cf] px-14 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.45)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full border-[72px] border-white/[0.08]" />
        <div className="absolute -bottom-40 left-20 h-[420px] w-[420px] rounded-full bg-cyan-300/15 blur-2xl" />

        <div className="relative z-10 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-blue-50 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            让知识持续沉淀
          </div>
          <h2 className="mt-6 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">从记录一道题开始，<br />构建你的技术体系。</h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-blue-100">快速记题、结构化整理、背题与答题，让每一次学习都有清晰轨迹。</p>
        </div>

        <div className="relative z-10 mx-auto my-8 w-full max-w-[610px]">
          <div className="absolute -left-8 top-20 rounded-2xl border border-white/25 bg-white/15 p-4 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-blue-600"><BookOpen className="h-4 w-4" /></span>
              <div><div className="font-semibold">个人题库</div><div className="mt-0.5 text-xs text-blue-100">随时可用</div></div>
            </div>
          </div>
          <div className="absolute -right-5 bottom-14 rounded-2xl border border-white/25 bg-white/15 p-4 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300 text-emerald-950"><CheckCircle2 className="h-4 w-4" /></span>
              <div><div className="font-semibold">学习进度</div><div className="mt-0.5 text-xs text-blue-100">实时保存</div></div>
            </div>
          </div>

          <div className="mx-auto w-[82%] rounded-[2rem] border border-white/30 bg-white/15 p-4 shadow-2xl shadow-blue-950/25 backdrop-blur-md">
            <div className="overflow-hidden rounded-[1.35rem] bg-[#0d1b3a] shadow-inner">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /></div>
                <span className="text-[11px] text-slate-400">growth-hub.ts</span>
                <Braces className="h-4 w-4 text-blue-300" />
              </div>
              <div className="space-y-3 p-6 font-mono text-sm leading-6">
                <p><span className="text-violet-300">const</span> <span className="text-sky-300">learning</span> <span className="text-white">= {'{'}</span></p>
                <p className="pl-6"><span className="text-blue-200">capture</span><span className="text-white">: </span><span className="text-emerald-300">'快速记录'</span><span className="text-white">,</span></p>
                <p className="pl-6"><span className="text-blue-200">organize</span><span className="text-white">: </span><span className="text-emerald-300">'分类管理'</span><span className="text-white">,</span></p>
                <p className="pl-6"><span className="text-blue-200">practice</span><span className="text-white">: [</span><span className="text-emerald-300">'背题'</span><span className="text-white">, </span><span className="text-emerald-300">'答题'</span><span className="text-white">]</span></p>
                <p className="text-white">{'}'}</p>
                <div className="mt-5 flex items-center gap-2 rounded-xl bg-white/[0.06] px-4 py-3 text-xs text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]" />
                  数据服务已安全连接
                </div>
              </div>
            </div>
            <div className="mx-auto h-7 w-32 bg-white/20 [clip-path:polygon(22%_0,78%_0,100%_100%,0_100%)]" />
            <div className="mx-auto h-2 w-48 rounded-full bg-white/25" />
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-blue-100/80">
          <span>TECH GROWTH HUB</span>
          <span>Keep learning. Keep growing.</span>
        </div>
      </aside>
    </div>
  </div>
);

const ErrorAlert: React.FC<{ message: string }> = ({ message }) => (
  <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
    {message}
  </div>
);

const labelClassName = 'mb-2 block text-sm font-medium text-slate-700';
const inputClassName =
  'h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-slate-950 shadow-sm placeholder:text-slate-400 transition focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10';
const iconInputClassName =
  'h-12 w-full rounded-lg border border-slate-200 bg-white pl-11 pr-4 text-slate-950 shadow-sm placeholder:text-slate-400 transition focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10';
const trailingIconButtonClassName =
  'absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700';

const validatePassword = (password: string): string | null => {
  if (password.length < 9) {
    return '密码长度至少为 9 位';
  }
  if (!/[a-zA-Z]/.test(password)) {
    return '密码必须包含字母';
  }
  if (!/[0-9]/.test(password)) {
    return '密码必须包含数字';
  }
  return null;
};

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [allowRegister, setAllowRegister] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    captcha: '',
  });
  const [captchaData, setCaptchaData] = useState<{ text: string; svg: string }>({ text: '', svg: '' });

  const refreshCaptcha = useCallback(() => {
    setCaptchaData(generateCaptcha());
  }, []);

  useEffect(() => {
    refreshCaptcha();
    const fetchPublicSettings = async () => {
      try {
        const response = await adminApi.getPublicSettings();
        setAllowRegister(response.data.allowRegister);
      } catch (fetchError) {
        console.error('Failed to fetch public settings:', fetchError);
      }
    };
    fetchPublicSettings();
  }, [refreshCaptcha]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.captcha.toLowerCase() !== captchaData.text.toLowerCase()) {
      setError('验证码错误，请重新输入');
      refreshCaptcha();
      setFormData((current) => ({ ...current, captcha: '' }));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authApi.login({
        username: formData.username,
        password: formData.password,
      });
      setAuth(response.data.user);
      navigate(response.data.user.must_change_password ? '/change-password' : '/', { replace: true });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || '用户名或密码错误，请重新输入';
      setError(errorMsg);
      refreshCaptcha();
      setFormData((current) => ({ ...current, captcha: '' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="欢迎登录"
      subtitle="登录后继续整理题库与学习进度"
      footer={
        allowRegister ? (
          <p className="text-center text-sm text-slate-500">
            还没有账户？{' '}
            <button
              type="button"
              onClick={() => navigate('/register')}
              className="font-semibold text-blue-600 transition-colors hover:text-blue-700"
            >
              立即注册
            </button>
          </p>
        ) : null
      }
    >
      {error ? <ErrorAlert message={error} /> : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClassName}>用户名</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="login-username"
              type="text"
              autoComplete="username"
              value={formData.username}
              onChange={(e) => setFormData((current) => ({ ...current, username: e.target.value }))}
              required
              placeholder="请输入用户名"
              className={iconInputClassName}
            />
          </div>
        </div>

        <div>
          <label className={labelClassName}>密码</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={formData.password}
              onChange={(e) => setFormData((current) => ({ ...current, password: e.target.value }))}
              required
              placeholder="请输入密码"
              className={`${iconInputClassName} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className={trailingIconButtonClassName}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClassName}>验证码</label>
          <div className="flex gap-3">
            <input
              data-testid="login-captcha"
              type="text"
              autoComplete="off"
              value={formData.captcha}
              onChange={(e) => setFormData((current) => ({ ...current, captcha: e.target.value }))}
              required
              placeholder="请输入验证码"
              className={`${inputClassName} min-w-0 flex-1`}
            />
            <button
              data-testid="login-captcha-refresh"
              type="button"
              onClick={refreshCaptcha}
              className="flex h-12 items-center gap-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 pl-3 pr-1 text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50"
              title="点击刷新验证码"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              <div
                data-testid="login-captcha-svg"
                className="flex h-12 items-center overflow-hidden rounded-xl bg-white/95"
                dangerouslySetInnerHTML={{ __html: captchaData.svg }}
              />
            </button>
          </div>
        </div>

        <button
          data-testid="login-submit"
          type="submit"
          disabled={loading}
          className="h-12 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/20 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </AuthShell>
  );
};

export const ChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth, logout } = useAuthStore();
  const [formData, setFormData] = useState({ password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    const passwordError = validatePassword(formData.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await authApi.updateProfile({ password: formData.password });
      setAuth(response.data);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || '密码修改失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } finally {
      logout();
      navigate('/login', { replace: true });
    }
  };

  return (
    <AuthShell
      title="首次登录，请修改密码"
      subtitle="默认密码仅用于初始化。设置新密码后才能进入系统。"
      footer={
        <button type="button" onClick={handleLogout} className="w-full text-center text-sm text-slate-500 hover:text-slate-800">
          退出登录
        </button>
      }
    >
      {error ? <ErrorAlert message={error} /> : null}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClassName}>新密码</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="change-password-new"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(event) => setFormData((current) => ({ ...current, password: event.target.value }))}
              required
              autoComplete="new-password"
              className={`${iconInputClassName} pr-11`}
            />
            <button type="button" onClick={() => setShowPassword((current) => !current)} className={trailingIconButtonClassName}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        <div>
          <label className={labelClassName}>确认新密码</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="change-password-confirm"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={(event) => setFormData((current) => ({ ...current, confirmPassword: event.target.value }))}
              required
              autoComplete="new-password"
              className={`${iconInputClassName} pr-11`}
            />
            <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} className={trailingIconButtonClassName}>
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">密码至少 9 位，并同时包含字母和数字</p>
        <button
          data-testid="change-password-submit"
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '保存中...' : '修改密码并进入系统'}
        </button>
      </form>
    </AuthShell>
  );
};

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    captcha: '',
  });
  const [captchaData, setCaptchaData] = useState<{ text: string; svg: string }>({ text: '', svg: '' });

  const refreshCaptcha = useCallback(() => {
    setCaptchaData(generateCaptcha());
  }, []);

  useEffect(() => {
    refreshCaptcha();
  }, [refreshCaptcha]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    const passwordError = validatePassword(formData.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (formData.captcha.toLowerCase() !== captchaData.text.toLowerCase()) {
      setError('验证码错误');
      refreshCaptcha();
      setFormData((current) => ({ ...current, captcha: '' }));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authApi.register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
      });
      setAuth(response.data.user);
      navigate('/', { replace: true });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || '注册失败';
      setError(errorMsg);
      refreshCaptcha();
      setFormData((current) => ({ ...current, captcha: '' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="注册"
      subtitle="创建账户后即可开始整理题库和学习。"
      footer={
        <p className="text-center text-sm text-slate-500">
          已有账户？{' '}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="font-semibold text-blue-600 transition-colors hover:text-blue-700"
          >
            返回登录
          </button>
        </p>
      }
    >
      {error ? <ErrorAlert message={error} /> : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClassName}>用户名</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoComplete="username"
              value={formData.username}
              onChange={(e) => setFormData((current) => ({ ...current, username: e.target.value }))}
              required
              placeholder="请输入用户名"
              className={iconInputClassName}
            />
          </div>
        </div>

        <div>
          <label className={labelClassName}>邮箱</label>
          <input
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={(e) => setFormData((current) => ({ ...current, email: e.target.value }))}
            required
            placeholder="请输入邮箱"
            className={inputClassName}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClassName}>密码</label>
            <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={formData.password}
                onChange={(e) => setFormData((current) => ({ ...current, password: e.target.value }))}
                required
                placeholder="请输入密码"
                className={`${iconInputClassName} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className={trailingIconButtonClassName}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className={labelClassName}>确认密码</label>
            <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData((current) => ({ ...current, confirmPassword: e.target.value }))}
                required
                placeholder="再次输入密码"
                className={`${iconInputClassName} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
                className={trailingIconButtonClassName}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
        </div>

        <p className="-mt-1 text-xs text-slate-500">密码至少 9 位，并同时包含字母和数字</p>

        <div>
          <label className={labelClassName}>验证码</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={formData.captcha}
              onChange={(e) => setFormData((current) => ({ ...current, captcha: e.target.value }))}
              required
              placeholder="请输入验证码"
              className={`${inputClassName} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={refreshCaptcha}
              className="flex h-[50px] items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-2 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100"
              title="点击刷新验证码"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              <div
                className="flex h-12 items-center overflow-hidden rounded-xl bg-white/95"
                dangerouslySetInnerHTML={{ __html: captchaData.svg }}
              />
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '注册中...' : '注册'}
        </button>
      </form>
    </AuthShell>
  );
};
