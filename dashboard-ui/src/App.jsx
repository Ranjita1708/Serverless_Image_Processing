import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Activity, Server, Image as ImageIcon, Box, Database, 
  Settings, Play, Filter, Maximize, CheckCircle, XCircle, 
  UploadCloud, RefreshCw, Download, Zap, AlertTriangle 
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';

// --- Configuration ---
const API_BASE = 'http://localhost:5000';

// --- Toast System ---
let toastCount = 0;
const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
    {toasts.map(t => (
      <div 
        key={t.id} 
        className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white font-medium animate-in slide-in-from-right-8 fade-in ${t.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`}
      >
        {t.type === 'error' ? <XCircle size={20} /> : <CheckCircle size={20} />}
        <span>{t.message}</span>
        <button onClick={() => removeToast(t.id)} className="ml-auto opacity-70 hover:opacity-100">
          <XCircle size={16} />
        </button>
      </div>
    ))}
  </div>
);

// --- Main App Component ---
export default function ServerlessDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [health, setHealth] = useState({ gateway: true, openfaas: false, minio: false, grafana: false });
  const [toasts, setToasts] = useState([]);
  
  const addToast = (msg, type = 'success') => {
    const id = toastCount++;
    setToasts(prev => [...prev, { id, message: msg, type }]);
    if (type !== 'error') setTimeout(() => removeToast(id), 3000);
  };
  
  const removeToast = id => setToasts(prev => prev.filter(t => t.id !== id));

  // Polling Health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await res.json();
        setHealth({
          gateway: true,
          openfaas: data.openfaas_reachable,
          minio: data.minio_ok !== false,
          grafana: data.grafana_ok !== false
        });
      } catch (err) {
        setHealth({ gateway: false, openfaas: false, minio: false, grafana: false });
      }
    };
    checkHealth();
    const intv = setInterval(checkHealth, 10000);
    return () => clearInterval(intv);
  }, []);

  const TabButton = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-4 py-2 font-medium rounded-md transition-colors ${
        activeTab === id 
          ? 'bg-slate-800 text-sky-400 border border-sky-500/30 shadow-[0_0_15px_rgba(56,189,248,0.1)]' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
      }`}
    >
      <Icon size={18} />
      {label}
    </button>
  );

  const StatusDot = ({ label, ok }) => (
    <div className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 bg-slate-800 rounded-full border border-slate-700">
      <div className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-red-500'}`} />
      <span className="text-slate-300">{label}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-200 font-sans selection:bg-sky-500/30 flex flex-col">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-[#0F172A]/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-sky-400 to-blue-600 rounded-lg shadow-[0_0_20px_rgba(56,189,248,0.3)]">
            <Zap className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight">
            Serverless Image Processing
          </h1>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
          <StatusDot label="Gateway" ok={health.gateway} />
          <StatusDot label="OpenFaaS" ok={health.openfaas} />
          <StatusDot label="MinIO" ok={health.minio} />
        </div>
      </nav>

      <div className="px-6 py-2 border-b border-slate-800/50 overflow-x-auto no-scrollbar flex gap-2">
        <TabButton id="dashboard" icon={Activity} label="Dashboard" />
        <TabButton id="process" icon={ImageIcon} label="Process Image" />
        <TabButton id="pipeline" icon={Box} label="Pipeline" />
        <TabButton id="minio" icon={Database} label="MinIO Browser" />
        <TabButton id="monitoring" icon={Server} label="Monitoring" />
        <TabButton id="functions" icon={Settings} label="Functions" />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-y-auto w-full max-w-7xl mx-auto">
        {!health.gateway && (
          <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 p-4 rounded-lg flex items-center gap-3">
            <AlertTriangle />
            <div>
              <p className="font-semibold">Backend Offline</p>
              <p className="text-sm opacity-80">Cannot reach FastAPI gateway at {API_BASE}. Showing UI in offline mode.</p>
            </div>
          </div>
        )}

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
          {activeTab === 'dashboard' && <DashboardPage />}
          {activeTab === 'process' && <ProcessPage addToast={addToast} />}
          {activeTab === 'pipeline' && <PipelinePage addToast={addToast} />}
          {activeTab === 'minio' && <MinioPage addToast={addToast} />}
          {activeTab === 'monitoring' && <MonitoringPage />}
          {activeTab === 'functions' && <FunctionsPage addToast={addToast} />}
        </div>
      </main>
    </div>
  );
}

// ==========================================
// PAGES
// ==========================================

function DashboardPage() {
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/minio/list/processed`);
        if (res.ok) {
          const d = await res.json();
          // Sort by last_modified if available, else by name. MinIO usually returns sorted.
          setObjects((d.objects || []).reverse());
        }
      } catch (e) {}
      setLoading(false);
    };
    load();
    const intv = setInterval(load, 3000);
    return () => clearInterval(intv);
  }, []);

  const totalSize = objects.reduce((acc, o) => acc + o.size, 0);
  const sizeMB = totalSize / 1024 / 1024;
  const sizeStr = sizeMB >= 1 ? sizeMB.toFixed(2) + ' MB' : (totalSize / 1024).toFixed(1) + ' KB';

  const stats = [
    { label: 'Total Jobs', val: loading ? '...' : objects.length.toString(), sub: 'Successfully processed' },
    { label: 'Avg Latency', val: 'Live', sub: 'See Monitoring tab' },
    { label: 'System Status', val: 'Online', sub: 'Accepting requests' },
    { label: 'Storage Used', val: loading ? '...' : sizeStr, sub: 'MinIO Processed Bucket' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-[#1E293B] border border-slate-700/50 p-5 rounded-xl hover:-translate-y-1 transition-transform shadow-lg shadow-black/20">
            <h3 className="text-slate-400 font-medium text-sm mb-1">{s.label}</h3>
            <p className="text-3xl font-bold text-white mb-2">{s.val}</p>
            <p className="text-xs text-sky-400/80 font-medium">{s.sub}</p>
          </div>
        ))}
      </div>
      
      <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl overflow-hidden shadow-lg shadow-black/20">
        <div className="p-4 border-b border-slate-700/50 bg-slate-800/30 flex justify-between items-center">
          <h2 className="font-semibold text-white">Recent Activity (Live Feed)</h2>
        </div>
        <div className="divide-y divide-slate-700/50">
          {objects.length === 0 && <div className="p-8 text-center text-slate-500">No processed images found. Run a function!</div>}
          {objects.slice(0, 10).map((o, i) => (
            <div key={o.key} className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
                  <img src={`${API_BASE}/minio/download/processed/${o.key}`} className="w-full h-full object-cover rounded-lg opacity-80" alt="" loading="lazy"/>
                </div>
                <div>
                  <p className="text-white font-medium">{o.key.split('/').pop()}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Size: {(o.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Processed</span>
                <p className="text-xs text-slate-500 mt-1">recently</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProcessPage({ addToast }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fnType, setFnType] = useState('resize');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  
  // Params
  const [pWidth, setPWidth] = useState(800);
  const [pHeight, setPHeight] = useState(600);
  const [pBrightness, setPBrightness] = useState(1.2);
  const [pFilter, setPFilter] = useState('grayscale');

  const onDrop = useCallback(e => {
    e.preventDefault();
    const f = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
    if (f && f.type.startsWith('image/')) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
      setResult(null);
    } else {
      addToast('Please upload an image file', 'error');
    }
  }, [addToast]);

  const processImage = async () => {
    if (!file) return addToast('Select an image first', 'error');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      
      if (fnType === 'resize') { 
        fd.append('width', pWidth); 
        fd.append('height', pHeight); 
      }
      if (fnType === 'enhance') { 
        fd.append('brightness', pBrightness); 
      }
      if (fnType === 'filter') { 
        fd.append('filter', pFilter); 
      }

      // Switch to /image/ endpoint to trigger unique filename generation and MinIO persistence in the gateway
      const res = await fetch(`${API_BASE}/image/${fnType}`, { method: 'POST', body: fd });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || 'API Error');
      }
      
      const blob = await res.blob();
      setResult(URL.createObjectURL(blob));
      addToast(`Success! Image processed and saved uniquely to MinIO.`);
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {/* Dropzone */}
        <div 
          onDragOver={e => e.preventDefault()} 
          onDrop={onDrop}
          className="border-2 border-dashed border-slate-700 bg-[#1E293B] rounded-xl p-8 text-center hover:border-sky-500/50 transition-colors cursor-pointer shadow-lg shadow-black/20"
        >
          <input type="file" id="up" className="hidden" onChange={onDrop} accept="image/*" />
          <label htmlFor="up" className="cursor-pointer flex flex-col items-center">
            {preview ? (
              <img src={preview} className="max-h-48 object-contain rounded-lg shadow-md mb-4" alt="Preview" />
            ) : (
              <UploadCloud size={48} className="text-sky-500 mb-4 opacity-80" />
            )}
            <span className="text-white font-medium">{file ? file.name : "Drag image here or click to browse"}</span>
          </label>
        </div>

        {/* Function Selector */}
        <div className="grid grid-cols-3 gap-2">
          {['resize', 'enhance', 'filter'].map(f => (
            <button 
              key={f} onClick={() => setFnType(f)}
              className={`py-3 px-2 rounded-lg text-sm font-medium capitalize transition-all ${
                fnType === f ? 'bg-sky-500 text-white shadow-[0_0_15px_rgba(56,189,248,0.4)]' : 'bg-[#1E293B] text-slate-400 hover:bg-slate-800 border border-slate-700/50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Dynamic Params */}
        <div className="bg-[#1E293B] border border-slate-700/50 p-5 rounded-xl shadow-lg shadow-black/20">
          <h3 className="font-medium text-white mb-4 capitalize">{fnType} Settings</h3>
          
          {fnType === 'resize' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 block mb-1">Width ({pWidth}px)</label>
                <input type="range" min="10" max="2000" value={pWidth} onChange={e=>setPWidth(e.target.value)} className="w-full accent-sky-500" />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Height ({pHeight}px)</label>
                <input type="range" min="10" max="2000" value={pHeight} onChange={e=>setPHeight(e.target.value)} className="w-full accent-sky-500" />
              </div>
            </div>
          )}
          
          {fnType === 'enhance' && (
            <div>
              <label className="text-sm text-slate-400 block mb-1">Brightness ({pBrightness})</label>
              <input type="range" min="0.1" max="3" step="0.1" value={pBrightness} onChange={e=>setPBrightness(e.target.value)} className="w-full accent-sky-500" />
            </div>
          )}

          {fnType === 'filter' && (
            <select value={pFilter} onChange={e=>setPFilter(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white">
              {['grayscale', 'blur', 'sepia', 'edge', 'invert', 'posterize'].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}

          <button 
            onClick={processImage} 
            disabled={!file || loading}
            className="w-full mt-6 bg-sky-500 hover:bg-sky-400 text-white font-bold py-3 rounded-lg shadow-[0_0_15px_rgba(56,189,248,0.3)] disabled:opacity-50 transition-all flex justify-center items-center gap-2"
          >
            {loading ? <RefreshCw className="animate-spin" /> : <Play size={18} fill="currentColor" />}
            {loading ? 'Processing...' : 'Run Function'}
          </button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl h-full min-h-[500px] flex items-center justify-center overflow-hidden relative shadow-lg shadow-black/20 p-4">
          {!preview && !result && (
             <div className="text-center opacity-50">
               <ImageIcon size={64} className="mx-auto mb-4" />
               <p>Output will appear here</p>
             </div>
          )}
          {preview && !result && <img src={preview} className="max-h-full max-w-full object-contain rounded" alt="Original" />}
          {result && <img src={result} className="max-h-full max-w-full object-contain rounded shadow-[0_0_30px_rgba(56,189,248,0.2)]" alt="Processed" />}
          
          {result && (
            <a href={result} download="processed.jpg" className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur border border-slate-700 text-white p-3 rounded-full hover:bg-sky-500 transition-colors shadow-lg">
              <Download size={20} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelinePage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 text-slate-400">
      <Box size={64} className="opacity-20" />
      <h2 className="text-2xl font-bold text-white">Visual Pipeline Builder</h2>
      <p>Chain functions together (Resize → Enhance → Filter) in a visual editor.</p>
      <div className="px-4 py-2 bg-slate-800 rounded-full text-sm font-medium text-sky-400 border border-sky-500/20">Coming soon in v1.1</div>
    </div>
  );
}

function MinioPage({ addToast }) {
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState('images');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/minio/list/${bucket}`);
      if(res.ok) {
        const d = await res.json();
        setObjects(d.objects || []);
      }
    } catch(e) {
      addToast('Error loading MinIO data', 'error');
    }
    setLoading(false);
  }, [bucket, addToast]);

  useEffect(() => { 
    loadData(); 
    const intv = setInterval(loadData, 3000);
    return () => clearInterval(intv);
  }, [loadData]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-[#1E293B] p-4 rounded-xl border border-slate-700/50 shadow-lg shadow-black/20">
        <div className="flex gap-2">
          <button onClick={() => setBucket('images')} className={`px-4 py-2 rounded-lg font-medium text-sm ${bucket === 'images' ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>📥 images bucket</button>
          <button onClick={() => setBucket('processed')} className={`px-4 py-2 rounded-lg font-medium text-sm ${bucket === 'processed' ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>📤 processed bucket</button>
        </div>
        <button onClick={loadData} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {objects.map(o => (
          <div key={o.key} className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-3 text-center hover:border-sky-500/50 transition-colors shadow-lg group">
            <div className="aspect-square bg-slate-800 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden group-hover:ring-2 ring-sky-500/50 transition-all">
               <img src={`${API_BASE}/minio/download/${bucket}/${o.key}`} className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity" alt={o.key} loading="lazy" />
            </div>
            <p className="text-xs text-white truncate font-medium" title={o.key}>{o.key.split('/').pop()}</p>
            <p className="text-[10px] text-slate-500 mt-1">{Math.round(o.size/1024)} KB</p>
          </div>
        ))}
        {!loading && objects.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-500">Bucket is empty</div>
        )}
      </div>
    </div>
  );
}

function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div className="bg-[#1E293B] border border-slate-700/50 p-6 rounded-xl shadow-lg shadow-black/20 h-[800px] flex flex-col">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Activity size={18} className="text-sky-400"/> Real-time Grafana Metrics
        </h3>
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-800/50 rounded-lg border border-slate-700/50 p-8 text-center">
          <Activity size={64} className="text-sky-500 mb-6 opacity-80" />
          <h2 className="text-2xl font-bold text-white mb-2">Live Metrics Dashboard</h2>
          <p className="text-slate-400 max-w-md mb-8">
            Your real-time metrics are securely running on your native Grafana instance. 
            Because of Grafana's strict security policies, it cannot be embedded inside an iframe.
          </p>
          <a 
            href="http://localhost:3000/d/openfaas/openfaas?orgId=1&refresh=5s&theme=dark" 
            target="_blank" 
            rel="noopener noreferrer"
            className="bg-sky-500 hover:bg-sky-400 text-white font-bold py-3 px-6 rounded-lg shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all flex items-center gap-2"
          >
            Open Grafana Dashboard <Maximize size={18} />
          </a>
        </div>
      </div>
    </div>
  );
}

function FunctionsPage() {
  const [health, setHealth] = useState(false);
  const [objects, setObjects] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const hRes = await fetch(`${API_BASE}/health`);
        if (hRes.ok) {
          const h = await hRes.json();
          setHealth(h.openfaas_reachable);
        }
        const mRes = await fetch(`${API_BASE}/minio/list/processed`);
        if (mRes.ok) {
          const m = await mRes.json();
          setObjects(m.objects || []);
        }
      } catch (e) {}
    };
    load();
    const intv = setInterval(load, 3000);
    return () => clearInterval(intv);
  }, []);

  const fns = [
    { name: 'fn-image-resize', icon: Maximize, color: 'text-sky-400', prefix: 'resize/' },
    { name: 'fn-image-enhance', icon: Zap, color: 'text-purple-400', prefix: 'enhance/' },
    { name: 'fn-image-filter', icon: Filter, color: 'text-emerald-400', prefix: 'filter/' },
    { name: 'fn-minio-trigger', icon: Database, color: 'text-amber-400', prefix: 'trigger/' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {fns.map(f => {
        const liveInvs = objects.filter(o => o.key.startsWith(f.prefix)).length;
        return (
          <div key={f.name} className="bg-[#1E293B] border border-slate-700/50 p-6 rounded-xl shadow-lg shadow-black/20 hover:border-sky-500/30 transition-colors">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg bg-slate-800 ${f.color}`}>
                  <f.icon size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">{f.name}</h3>
                  <p className="text-sm text-slate-400">OpenFaaS Function</p>
                </div>
              </div>
              <div className={`px-3 py-1 border rounded-full text-xs font-bold uppercase tracking-wider ${health ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                {health ? 'Ready' : 'Down'}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">Live Replicas</p>
                <p className="text-xl font-semibold text-white">{health ? 1 : 0}</p>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">Live Invocations</p>
                <p className="text-xl font-semibold text-white">{liveInvs}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
