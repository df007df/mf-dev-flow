"use client";
export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="dashboard">
      <h1>观察台暂时无法显示</h1>
      <p>请重试；若问题持续，请检查归档记录格式与本地服务日志。</p>
      <button className="button" onClick={reset}>
        重新读取
      </button>
    </main>
  );
}
