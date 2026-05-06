import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Activity, Server, Image as ImageIcon, Box, Database, 
  Settings, Play, Filter, Maximize, CheckCircle, XCircle, 
  UploadCloud, RefreshCw, Download, Zap, AlertTriangle,
  Layers, ChevronDown
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
      className={`flex items-center gap-2 px-4 py-2 font-medium rounded-lg transition-all ${
        activeTab === id 
          ? 'bg-sky-500 text-white shadow-md shadow-sky-200' 
          : 'text-slate-500 hover:text-sky-600 hover:bg-sky-50'
      }`}
    >
      <Icon size={18} />
      {label}
    </button>
  );

  const StatusDot = ({ label, ok }) => (
    <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 bg-white/50 backdrop-blur rounded-full border border-sky-100/50">
      <div className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-slate-600">{label}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-transparent text-slate-800 font-sans selection:bg-sky-200 flex flex-col">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-white/70 backdrop-blur-lg border-b border-sky-100 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-sky-400 to-cyan-400 rounded-xl shadow-lg shadow-sky-200">
            <Zap className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">
            Serverless <span className="text-sky-500">Image Processing</span>
          </h1>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
          <StatusDot label="Gateway" ok={health.gateway} />
          <StatusDot label="OpenFaaS" ok={health.openfaas} />
          <StatusDot label="MinIO" ok={health.minio} />
        </div>
      </nav>

      <div className="px-6 py-2 border-b border-sky-100/50 bg-white/30 overflow-x-auto no-scrollbar flex gap-2">
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
          <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-600 p-4 rounded-xl flex items-center gap-3 shadow-sm">
            <AlertTriangle />
            <div>
              <p className="font-bold">Backend Offline</p>
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
          <div key={s.label} className="bg-white border border-sky-100 p-5 rounded-2xl hover:shadow-lg transition-all shadow-sm">
            <h3 className="text-slate-500 font-medium text-sm mb-1">{s.label}</h3>
            <p className="text-3xl font-bold text-slate-800 mb-2">{s.val}</p>
            <p className="text-xs text-sky-500 font-semibold">{s.sub}</p>
          </div>
        ))}
      </div>
      
      <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-sky-50 bg-sky-50/20 flex justify-between items-center">
          <h2 className="font-semibold text-slate-800">Recent Activity (Live Feed)</h2>
        </div>
        <div className="divide-y divide-sky-50">
          {objects.length === 0 && <div className="p-8 text-center text-slate-400">No processed images found. Run a function!</div>}
          {objects.slice(0, 10).map((o, i) => (
            <div key={o.key} className="p-4 flex items-center justify-between hover:bg-sky-50/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center border border-sky-100">
                  <img src={`${API_BASE}/minio/download/processed/${o.key}`} className="w-full h-full object-cover rounded-lg" alt="" loading="lazy"/>
                </div>
                <div>
                  <p className="text-slate-800 font-medium">{o.key.split('/').pop()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Size: {(o.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-600 border border-emerald-200">Processed</span>
                <p className="text-xs text-slate-400 mt-1 font-medium">recently</p>
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
          className="border-2 border-dashed border-sky-100 bg-sky-50/50 rounded-2xl p-8 text-center hover:border-sky-300 transition-colors cursor-pointer shadow-sm"
        >
          <input type="file" id="up" className="hidden" onChange={onDrop} accept="image/*" />
          <label htmlFor="up" className="cursor-pointer flex flex-col items-center">
            {preview ? (
              <img src={preview} className="max-h-48 object-contain rounded-xl shadow-md mb-4" alt="Preview" />
            ) : (
              <UploadCloud size={48} className="text-sky-400 mb-4 opacity-60" />
            )}
            <span className="text-slate-600 font-medium">{file ? file.name : "Drag image here or click to browse"}</span>
          </label>
        </div>

        {/* Function Selector */}
        <div className="grid grid-cols-3 gap-2">
          {['resize', 'enhance', 'filter'].map(f => (
            <button 
              key={f} onClick={() => setFnType(f)}
              className={`py-3 px-2 rounded-xl text-sm font-bold capitalize transition-all ${
                fnType === f ? 'bg-sky-500 text-white shadow-md shadow-sky-200' : 'bg-white text-slate-500 hover:bg-sky-50 border border-sky-100'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Dynamic Params */}
        <div className="bg-white border border-sky-100 p-5 rounded-2xl shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4 capitalize">{fnType} Settings</h3>
          
          {fnType === 'resize' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-500 block mb-1 font-medium">Width ({pWidth}px)</label>
                <input type="range" min="10" max="2000" value={pWidth} onChange={e=>setPWidth(e.target.value)} className="w-full accent-sky-500" />
              </div>
              <div>
                <label className="text-sm text-slate-500 block mb-1 font-medium">Height ({pHeight}px)</label>
                <input type="range" min="10" max="2000" value={pHeight} onChange={e=>setPHeight(e.target.value)} className="w-full accent-sky-500" />
              </div>
            </div>
          )}
          
          {fnType === 'enhance' && (
            <div>
              <label className="text-sm text-slate-500 block mb-1 font-medium">Brightness ({pBrightness}x)</label>
              <input type="range" min="0.1" max="3" step="0.1" value={pBrightness} onChange={e=>setPBrightness(e.target.value)} className="w-full accent-sky-500" />
            </div>
          )}

          {fnType === 'filter' && (
            <select value={pFilter} onChange={e=>setPFilter(e.target.value)} className="w-full bg-slate-50 border border-sky-100 rounded-xl px-3 py-2 text-slate-700 outline-none focus:ring-2 ring-sky-500/20 transition-all">
              {['grayscale', 'blur', 'sepia', 'edge', 'invert', 'posterize'].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}

          <button 
            onClick={processImage} 
            disabled={!file || loading}
            className="w-full mt-6 bg-gradient-to-r from-sky-400 to-cyan-300 hover:from-sky-500 hover:to-cyan-400 text-white font-bold py-3 rounded-xl shadow-lg shadow-sky-200 disabled:opacity-50 transition-all flex justify-center items-center gap-2"
          >
            {loading ? <RefreshCw className="animate-spin" /> : <Play size={18} fill="currentColor" />}
            {loading ? 'Processing...' : 'Run Function'}
          </button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="bg-white border border-sky-100 rounded-2xl h-full min-h-[500px] flex items-center justify-center overflow-hidden relative shadow-sm p-4">
          {!preview && !result && (
             <div className="text-center opacity-30">
               <ImageIcon size={64} className="mx-auto mb-4" />
               <p className="text-lg font-bold">Output will appear here</p>
             </div>
          )}
          {preview && !result && <img src={preview} className="max-h-full max-w-full object-contain rounded-xl" alt="Original" />}
          {result && <img src={result} className="max-h-full max-w-full object-contain rounded-xl shadow-xl shadow-sky-100" alt="Processed" />}
          
          {result && (
            <a href={result} download="processed.jpg" className="absolute bottom-4 right-4 bg-white/80 backdrop-blur border border-sky-100 text-sky-500 p-3 rounded-full hover:bg-sky-500 hover:text-white transition-all shadow-lg">
              <Download size={20} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelinePage({ addToast }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Stage Toggles
  const [useResize, setUseResize] = useState(true);
  const [useEnhance, setUseEnhance] = useState(true);
  const [useFilter, setUseFilter] = useState(true);

  // Params
  const [pWidth, setPWidth] = useState(800);
  const [pHeight, setPHeight] = useState(600);
  const [pBrightness, setPBrightness] = useState(1.1);
  const [pContrast, setPContrast] = useState(1.1);
  const [pFilter, setPFilter] = useState('sepia');

  const onDrop = useCallback(e => {
    e.preventDefault();
    const f = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
    if (f && f.type.startsWith('image/')) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
      setResult(null);
    }
  }, []);

  const runPipeline = async () => {
    if (!file) return addToast('Select an image first', 'error');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      
      // If disabled, we send "passthrough" values
      fd.append('width', useResize ? pWidth : '');
      fd.append('height', useResize ? pHeight : '');
      fd.append('maintain_aspect_ratio', 'true');
      
      fd.append('brightness', useEnhance ? pBrightness : 1.0);
      fd.append('contrast', useEnhance ? pContrast : 1.0);
      
      fd.append('filter', useFilter ? pFilter : 'none');

      const res = await fetch(`${API_BASE}/image/pipeline`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Pipeline Execution Failed');
      
      const blob = await res.blob();
      setResult(URL.createObjectURL(blob));
      addToast('Pipeline completed successfully!');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Pipeline Config */}
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-white border border-sky-100 rounded-2xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Layers size={20} className="text-sky-500" /> Pipeline Flow
          </h3>
          
          <div className="space-y-4 relative">
            {/* Step 1: Resize */}
            <div className={`p-4 rounded-2xl border transition-all ${useResize ? 'bg-sky-50 border-sky-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
              <div className="flex justify-between items-center mb-4">
                <span className="text-slate-700 font-bold flex items-center gap-2"><Maximize size={16}/> 1. Resize</span>
                <input type="checkbox" checked={useResize} onChange={e=>setUseResize(e.target.checked)} className="w-5 h-5 accent-sky-500" />
              </div>
              {useResize && (
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium"><span>Target Width</span><span>{pWidth}px</span></div>
                    <input type="range" min="100" max="1920" value={pWidth} onChange={e=>setPWidth(e.target.value)} className="w-full accent-sky-500" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium"><span>Target Height</span><span>{pHeight}px</span></div>
                    <input type="range" min="100" max="1920" value={pHeight} onChange={e=>setPHeight(e.target.value)} className="w-full accent-sky-500" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-center"><ChevronDown size={20} className="text-sky-200" /></div>

            {/* Step 2: Enhance */}
            <div className={`p-4 rounded-2xl border transition-all ${useEnhance ? 'bg-purple-50 border-purple-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
              <div className="flex justify-between items-center mb-4">
                <span className="text-slate-700 font-bold flex items-center gap-2"><Zap size={16}/> 2. Enhance</span>
                <input type="checkbox" checked={useEnhance} onChange={e=>setUseEnhance(e.target.checked)} className="w-5 h-5 accent-purple-500" />
              </div>
              {useEnhance && (
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium"><span>Brightness</span><span>{pBrightness}x</span></div>
                    <input type="range" min="0.5" max="2" step="0.1" value={pBrightness} onChange={e=>setPBrightness(e.target.value)} className="w-full accent-purple-500" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium"><span>Contrast</span><span>{pContrast}x</span></div>
                    <input type="range" min="0.5" max="2" step="0.1" value={pContrast} onChange={e=>setPContrast(e.target.value)} className="w-full accent-purple-500" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-center"><ChevronDown size={20} className="text-sky-200" /></div>

            {/* Step 3: Filter */}
            <div className={`p-4 rounded-2xl border transition-all ${useFilter ? 'bg-emerald-50 border-emerald-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
              <div className="flex justify-between items-center mb-4">
                <span className="text-slate-700 font-bold flex items-center gap-2"><Filter size={16}/> 3. Filter</span>
                <input type="checkbox" checked={useFilter} onChange={e=>setUseFilter(e.target.checked)} className="w-5 h-5 accent-emerald-500" />
              </div>
              {useFilter && (
                <select value={pFilter} onChange={e=>setPFilter(e.target.value)} className="w-full bg-white border border-emerald-100 rounded-xl px-3 py-2 text-slate-700 text-sm outline-none focus:ring-2 ring-emerald-500/20">
                  {['grayscale', 'sepia', 'blur', 'edge', 'invert'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
            </div>
          </div>

          <button 
            onClick={runPipeline}
            disabled={!file || loading}
            className="w-full mt-8 bg-gradient-to-r from-sky-400 to-cyan-300 hover:from-sky-500 hover:to-cyan-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-sky-200 disabled:opacity-50 transition-all flex justify-center items-center gap-3"
          >
            {loading ? <RefreshCw className="animate-spin" /> : <Play size={20} fill="currentColor" />}
            {loading ? 'Executing Pipeline...' : 'Deploy Pipeline'}
          </button>
        </div>
      </div>

      {/* Right: Preview */}
      <div className="lg:col-span-8 space-y-4">
        <div 
          onDragOver={e => e.preventDefault()} onDrop={onDrop}
          className="bg-white border border-sky-100 rounded-2xl min-h-[600px] flex flex-col shadow-sm overflow-hidden"
        >
          <div className="p-4 border-b border-sky-50 bg-sky-50/30 flex justify-between items-center">
            <span className="text-sm font-bold text-slate-500 tracking-wide uppercase">Execution Preview</span>
            <input type="file" id="pipe-up" className="hidden" onChange={onDrop} />
            <label htmlFor="pipe-up" className="text-xs text-sky-500 hover:text-sky-600 cursor-pointer flex items-center gap-1 font-bold">
              <UploadCloud size={14}/> CHANGE SOURCE
            </label>
          </div>
          
          <div className="flex-1 flex items-center justify-center p-8 relative">
            {!preview && (
              <div className="text-center opacity-30">
                <UploadCloud size={64} className="mx-auto mb-4 text-sky-400" />
                <p className="text-xl font-bold text-slate-800">Drop source image to start</p>
              </div>
            )}
            {preview && !result && (
              <div className="text-center">
                <img src={preview} className="max-h-[500px] rounded-2xl shadow-lg opacity-80 border border-sky-100" alt="Source" />
                <p className="text-sky-500 mt-6 font-black tracking-[0.2em] uppercase text-xs animate-pulse">Waiting for deployment...</p>
              </div>
            )}
            {result && (
              <div className="w-full h-full flex items-center justify-center">
                <img src={result} className="max-h-[500px] rounded-2xl shadow-2xl border border-sky-100" alt="Result" />
                <a href={result} download="pipeline_result.jpg" className="absolute top-4 right-4 bg-emerald-500 text-white p-3 rounded-full hover:bg-emerald-400 transition-all shadow-lg">
                  <Download size={20} />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
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
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-sky-100 shadow-sm">
        <div className="flex gap-2">
          <button onClick={() => setBucket('images')} className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${bucket === 'images' ? 'bg-sky-500 text-white shadow-md shadow-sky-100' : 'bg-sky-50 text-sky-600 hover:bg-sky-100'}`}>📥 images bucket</button>
          <button onClick={() => setBucket('processed')} className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${bucket === 'processed' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>📤 processed bucket</button>
        </div>
        <button onClick={loadData} className="p-2 text-sky-500 hover:bg-sky-50 rounded-xl border border-sky-100 transition-all shadow-sm"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {objects.map(o => (
          <div key={o.key} className="bg-white border border-sky-100 rounded-2xl p-3 text-center hover:shadow-lg transition-all shadow-sm group">
            <div className="aspect-square bg-sky-50 rounded-xl mb-3 flex items-center justify-center relative overflow-hidden group-hover:ring-2 ring-sky-300 transition-all">
               <img src={`${API_BASE}/minio/download/${bucket}/${o.key}`} className="object-cover w-full h-full" alt={o.key} loading="lazy" />
            </div>
            <p className="text-xs text-slate-700 truncate font-bold" title={o.key}>{o.key.split('/').pop()}</p>
            <p className="text-[10px] text-slate-400 mt-1 font-medium">{Math.round(o.size/1024)} KB</p>
          </div>
        ))}
        {!loading && objects.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-400 font-medium">Bucket is empty</div>
        )}
      </div>
    </div>
  );
}

function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-sky-100 p-8 rounded-2xl shadow-sm h-[800px] flex flex-col">
        <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Activity size={20} className="text-sky-500"/> Real-time Grafana Metrics
        </h3>
        <div className="flex-1 flex flex-col items-center justify-center bg-sky-50/30 rounded-2xl border border-sky-100/50 p-12 text-center">
          <div className="p-6 bg-sky-100 rounded-full mb-8 shadow-inner shadow-sky-200/50">
            <Activity size={64} className="text-sky-500 animate-pulse" />
          </div>
          <h2 className="text-3xl font-bold text-slate-800 mb-4 tracking-tight">Live Metrics Dashboard</h2>
          <p className="text-slate-500 max-w-md mb-10 leading-relaxed font-medium">
            Your real-time metrics are securely running on your native Grafana instance. 
            Because of Grafana's strict security policies, it cannot be embedded inside an iframe.
          </p>
          <a 
            href="http://localhost:3000/d/openfaas/openfaas?orgId=1&refresh=5s&theme=light" 
            target="_blank" 
            rel="noopener noreferrer"
            className="bg-gradient-to-r from-sky-400 to-cyan-300 hover:from-sky-500 hover:to-cyan-400 text-white font-bold py-4 px-10 rounded-2xl shadow-lg shadow-sky-200 transition-all flex items-center gap-3 transform hover:-translate-y-1"
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
          <div key={f.name} className="bg-white border border-sky-100 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-xl bg-sky-50/50 border border-sky-100 ${f.color} group-hover:scale-110 transition-transform`}>
                  <f.icon size={28} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-xl">{f.name}</h3>
                  <p className="text-sm text-slate-400 font-medium tracking-wide uppercase">OpenFaaS Function</p>
                </div>
              </div>
              <div className={`px-4 py-1.5 border rounded-full text-[10px] font-bold uppercase tracking-[0.1em] ${health ? 'bg-emerald-50 text-emerald-500 border-emerald-100' : 'bg-red-50 text-red-500 border-red-100'}`}>
                {health ? '● Ready' : '○ Down'}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/50">
                <p className="text-xs text-slate-500 mb-1 font-bold tracking-tight uppercase">Live Replicas</p>
                <p className="text-2xl font-black text-slate-800">{health ? 1 : 0}</p>
              </div>
              <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/50">
                <p className="text-xs text-slate-500 mb-1 font-bold tracking-tight uppercase">Invocations</p>
                <p className="text-2xl font-black text-slate-800">{liveInvs}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
