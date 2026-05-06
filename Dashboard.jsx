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
          openfaas: data.openfaas_ok,
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
  const stats = [
    { label: 'Total Jobs', val: '142', sub: '+12 today' },
    { label: 'Avg Latency', val: '124ms', sub: 'Last 1hr' },
    { label: 'Success Rate', val: '99.4%', sub: 'No errors today' },
    { label: 'Storage Used', val: '1.2 GB', sub: 'MinIO Processed Bucket' },
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
          <h2 className="font-semibold text-white">Recent Activity</h2>
          <button className="text-sky-400 text-sm hover:text-sky-300">View All</button>
        </div>
        <div className="divide-y divide-slate-700/50">
          {[1,2,3,4].map(i => (
            <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
                  <ImageIcon size={20} className="text-sky-400" />
                </div>
                <div>
                  <p className="text-white font-medium">fn-image-filter (sepia)</p>
                  <p className="text-xs text-slate-400 mt-0.5">photo_{i}.jpg • 10.2 KB</p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Success</span>
                <p className="text-xs text-slate-500 mt-1">{i * 2} mins ago • 14{i}ms</p>
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
      
      if (fnType === 'resize') { fd.append('width', pWidth); fd.append('height', pHeight); }
      if (fnType === 'enhance') { fd.append('brightness', pBrightness); }
      if (fnType === 'filter') { fd.append('filter', pFilter); }

      // We use the JSON endpoint here to get metadata, then decode base64 for display
      const res = await fetch(`${API_BASE}/process/${fnType}`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      
      if (data.status === 'ok') {
        setResult(`data:image/jpeg;base64,${data.image_b64}`);
        addToast(`Success! Took ${data.meta.processing_time_ms}ms`);
      } else {
        throw new Error(data.message || 'Error processing');
      }
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

  useEffect(() => { loadData(); }, [loadData]);

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
            <div className="aspect-square bg-slate-800 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden">
               <ImageIcon className="text-slate-600 group-hover:text-sky-500 transition-colors" size={32} />
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
  const data = [
    { time: '10:00', resize: 40, enhance: 24, filter: 24 },
    { time: '10:05', resize: 30, enhance: 13, filter: 22 },
    { time: '10:10', resize: 20, enhance: 48, filter: 22 },
    { time: '10:15', resize: 27, enhance: 39, filter: 20 },
    { time: '10:20', resize: 18, enhance: 48, filter: 21 },
    { time: '10:25', resize: 23, enhance: 38, filter: 25 },
    { time: '10:30', resize: 34, enhance: 43, filter: 21 },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-[#1E293B] border border-slate-700/50 p-6 rounded-xl shadow-lg shadow-black/20">
        <h3 className="font-semibold text-white mb-6 flex items-center gap-2"><Activity size={18} className="text-sky-400"/> Invocations (Last 30m)</h3>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <RechartsTooltip contentStyle={{ backgroundColor: '#1E293B', borderColor: '#334155', color: '#fff' }} />
              <Line type="monotone" dataKey="resize" stroke="#38BDF8" strokeWidth={3} dot={{r:4}} />
              <Line type="monotone" dataKey="enhance" stroke="#A78BFA" strokeWidth={3} dot={{r:4}} />
              <Line type="monotone" dataKey="filter" stroke="#34D399" strokeWidth={3} dot={{r:4}} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function FunctionsPage() {
  const fns = [
    { name: 'fn-image-resize', replicas: 1, invs: 142, icon: Maximize, color: 'text-sky-400' },
    { name: 'fn-image-enhance', replicas: 1, invs: 89, icon: Zap, color: 'text-purple-400' },
    { name: 'fn-image-filter', replicas: 1, invs: 112, icon: Filter, color: 'text-emerald-400' },
    { name: 'fn-minio-trigger', replicas: 1, invs: 343, icon: Database, color: 'text-amber-400' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {fns.map(f => (
        <div key={f.name} className="bg-[#1E293B] border border-slate-700/50 p-6 rounded-xl shadow-lg shadow-black/20">
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
            <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-bold uppercase tracking-wider">Ready</div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-1">Replicas</p>
              <p className="text-xl font-semibold text-white">{f.replicas}</p>
            </div>
            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-1">Total Invocations</p>
              <p className="text-xl font-semibold text-white">{f.invs}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
