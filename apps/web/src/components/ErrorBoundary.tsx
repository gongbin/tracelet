import React from 'react';
import { useApp } from '../store/app.js';

interface State { error: Error | null }
/** 工作区错误边界：渲染异常时显示可恢复的提示，而不是整页黑屏。 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('[tracelet] 渲染错误', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    return (
      <div className="col" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, background: 'var(--bg-canvas)' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>页面渲染出错了</div>
        <pre className="mono xs" style={{ maxWidth: 720, whiteSpace: 'pre-wrap', color: 'var(--error)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>{err.message}</pre>
        <div className="muted small">项目数据已自动保存；可以返回首页重新打开，或撤销上一步操作。</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={() => { this.setState({ error: null }); useApp.getState().closeProject(); history.replaceState(null, '', '/'); }}>返回首页</button>
          <button className="btn" onClick={() => { const ed = useApp.getState().editor; if (ed?.canUndo) ed.undo(); this.setState({ error: null }); }}>撤销上一步并重试</button>
          <button className="btn" onClick={() => location.reload()}>重新加载</button>
        </div>
      </div>
    );
  }
}
