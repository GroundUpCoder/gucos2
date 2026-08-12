import { lazy, Suspense } from 'react'; import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider } from 'react-router-dom'; import { Toaster } from 'sonner';
import AppLayout from './pages/AppLayout'; import HomePage from './pages/HomePage'; import FilesPage from './pages/FilesPage'; import TermPage from './pages/TermPage'; import ProcessesPage from './pages/ProcessesPage'; import SettingsPage from './pages/SettingsPage'; import ChatPage from './pages/ChatPage'; import ThreadsPage from './pages/ThreadsPage';
import { GraphicalProcessHost } from './components/GraphicalProcessHost';
import { AgentSessionProvider } from './agent/session';
const EditorPage=lazy(()=>import('./pages/EditorPage'));
// Data router (createBrowserRouter), not <BrowserRouter>: the editor's
// unsaved-changes guard blocks in-app navigation with useBlocker, which only
// exists on data routers. The route tree is unchanged; the previously
// always-mounted siblings (agent session, graphical host, toasts) live on a
// root layout route so they stay mounted across every navigation as before.
function Root(){return <AgentSessionProvider><Outlet/><GraphicalProcessHost/><Toaster position="bottom-right"/></AgentSessionProvider>}
const router=createBrowserRouter(createRoutesFromElements(<Route element={<Root/>}><Route element={<AppLayout/>}><Route path="/" element={<HomePage/>}/><Route path="/chat" element={<ChatPage/>}/><Route path="/chat/:threadId" element={<ChatPage/>}/><Route path="/threads" element={<ThreadsPage/>}/><Route path="/files" element={<FilesPage/>}/><Route path="/files/*" element={<FilesPage/>}/><Route path="/edit/*" element={<Suspense fallback={<div className="grid place-items-center flex-1">Loading editor…</div>}><EditorPage/></Suspense>}/><Route path="/term" element={<TermPage/>}/><Route path="/processes" element={<ProcessesPage/>}/><Route path="/settings" element={<SettingsPage/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Route>));
export default function App(){return <RouterProvider router={router}/>}
