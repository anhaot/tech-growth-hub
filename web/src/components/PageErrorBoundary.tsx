import { Component, ReactNode } from 'react';

export default class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center"><h1 className="text-xl font-semibold">页面暂时无法显示</h1><p className="text-gray-500">请重新加载页面后再试。</p><button className="btn-primary" onClick={() => window.location.reload()}>重新加载页面</button></main>;
  }
}
