import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Play, MessageSquare, BookOpen, CheckCircle, XCircle, Send, Loader2, Lightbulb, Code2, Bug, Terminal } from 'lucide-react';
import Editor, { OnMount } from '@monaco-editor/react';

// ==========================================
// 1. 模拟的“名师锦囊”数据库 (Knowledge Base)
// ==========================================
const TEACHER_KNOWLEDGE_BASE: Record<string, any> = {
  "P1001": {
    pitfalls: [
      "初学者极易习惯性使用 int 声明变量 A 和 B。",
      "本题数据范围最大达到 10^18，而 C++ 中 int 的最大值约为 2*10^9，会导致整数溢出（Integer Overflow）。"
    ],
    teachingStrategy: [
      "1. 千万不要直接告诉学生 '你要用 long long'。",
      "2. 引导话术：先问学生 '你注意看题目的数据范围了吗？10的18次方有多大？'。",
      "3. 进阶引导：问学生 'C++ 里 int 类型最大能存多大的数字？如果存不下会发生什么？'。",
      "4. 只有当学生明白溢出后，再引导他们寻找更大的整数类型。"
    ]
  }
};

// 通用调试启发式 (General Debugging Heuristics)
const GENERAL_DEBUGGING_HEURISTICS = {
  CE: "扮演‘翻译官’。引导学生阅读编译器报错的行号和关键词。不要直接指出错误，问他们‘编译器在暗示你遗漏了什么吗？’",
  WA_LOGIC: "扮演‘推演家’。引导学生构造反例（如极大值、极小值、0、负数）。问他们‘如果输入是 X，你的程序第 Y 行会发生什么？’",
  WA_ALGO: "扮演‘架构师’。引导学生思考题目限制（如时间复杂度、空间复杂度）。问他们‘当前的算法在处理 10^5 数据量时会超时吗？’",
  RE: "扮演‘侦探’。针对 Segmentation Fault 等错误，引导学生检查数组边界或递归深度。问他们‘你申请的空间够用吗？’"
};

// 常见运行时错误知识库 (RAG for Error Messages)
const COMMON_RUNTIME_ERRORS: Record<string, string> = {
  "Segmentation Fault": "通常是数组越界、访问了非法内存地址或递归过深导致栈溢出。",
  "Floating Point Exception": "通常是除以了 0 或取模了 0。",
  "Killed / Out of Memory": "程序申请的内存超过了题目限制。"
};

// 模拟的题目数据
const MOCK_PROBLEM = {
  id: "P1001",
  title: "P1001 巨大数字求和",
  tags: ["入门", "数据类型", "模拟"],
  description: "给定两个正整数 $A$ 和 $B$，请计算它们的和并输出。\n\n**注意：这是一道看似简单但暗藏玄机的题目！**",
  inputFormat: "一行，包含两个正整数 $A$ 和 $B$，用空格隔开。",
  outputFormat: "一行，一个整数，表示 $A + B$ 的结果。",
  constraints: "$1 \\le A, B \\le 10^{18}$",
  samples: [
    { input: "1000000000000 2000000000000", output: "3000000000000" }
  ]
};

// 默认占位代码
const DEFAULT_CODE = `#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
`;

// === 新增：轻量级 Markdown 渲染器组件 ===
const MarkdownRenderer = ({ content }: { content: string }) => {
  if (!content) return null;
  // 按代码块分割内容 (保留代码块作为一个整体)
  const parts = content.split(/(```[\w]*\n[\s\S]*?```)/g);

  return (
    <div className="text-sm space-y-2">
      {parts.map((part, index) => {
        if (part.startsWith('```')) {
          // 渲染代码块
          const match = part.match(/```([\w]*)\n([\s\S]*?)```/);
          const language = match && match[1] ? match[1] : 'code';
          const code = match ? match[2] : part.replace(/```/g, '');
          
          return (
            <div key={index} className="my-2 bg-gray-900 rounded-md overflow-hidden border border-gray-700 shadow-inner">
              <div className="bg-gray-800 text-gray-400 text-[10px] uppercase px-3 py-1 flex justify-between border-b border-gray-700">
                <span className="font-mono">{language}</span>
              </div>
              <pre className="p-3 overflow-x-auto text-blue-300 text-xs font-mono leading-relaxed">
                <code>{code.trim()}</code>
              </pre>
            </div>
          );
        } else {
          // 渲染普通文本段落
          const paragraphs = part.split('\n').filter(p => p.trim() !== '');
          return paragraphs.map((p, pIndex) => {
             // 处理行内代码 `code` 和 加粗 **text**
             const renderInline = (text: string) => {
                const inlineParts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
                return inlineParts.map((ip, i) => {
                    if (ip.startsWith('`') && ip.endsWith('`')) {
                        return <code key={i} className="bg-gray-900 text-yellow-300 px-1.5 py-0.5 mx-0.5 rounded text-xs border border-gray-700 font-mono">{ip.slice(1, -1)}</code>;
                    } else if (ip.startsWith('**') && ip.endsWith('**')) {
                        return <strong key={i} className="font-bold text-white">{ip.slice(2, -2)}</strong>;
                    } else {
                        return <span key={i}>{ip}</span>;
                    }
                });
             };

             return <p key={`${index}-${pIndex}`} className="leading-relaxed">{renderInline(p)}</p>;
          });
        }
      })}
    </div>
  );
};

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  feedbackSubmitted?: boolean;
};

// ==========================================
// 2. 辅助组件：可视化调试面板
// ==========================================
const VisualDebugger = ({ variables }: { variables: Record<string, any> }) => {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex flex-col h-full">
      <div className="bg-gray-800 px-3 py-2 border-b border-gray-700 flex items-center gap-2">
        <Bug className="w-4 h-4 text-orange-400" />
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">变量监控 (Variable Watch)</span>
      </div>
      <div className="p-3 flex-1 overflow-y-auto font-mono text-xs space-y-2">
        {Object.entries(variables).length === 0 ? (
          <div className="text-gray-600 italic">暂无运行数据，提交代码后将显示模拟状态...</div>
        ) : (
          Object.entries(variables).map(([name, value]) => (
            <div key={name} className="flex justify-between items-center border-b border-gray-800 pb-1">
              <span className="text-blue-400">{name}</span>
              <span className="text-orange-300">{JSON.stringify(value)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ==========================================
// 3. 主应用组件
// ==========================================
export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'assistant', content: '你好！我是你的 AI 助教。在做题遇到困难时，随时可以向我提问。如果你觉得没思路，也可以点击下方的“请求思路提示”。' }
  ]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<'AC' | 'WA' | 'CE' | 'Running' | null>(null);
  const [debugVariables, setDebugVariables] = useState<Record<string, any>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // 自定义主题
    monaco.editor.defineTheme('oi-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#111827', // gray-900
      }
    });
    monaco.editor.setTheme('oi-dark');
  };

  // 在编辑器中添加 AI 引导气泡 (Decorations)
  const addEditorHint = (line: number, message: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    
    const monaco = monacoRef.current;
    const editor = editorRef.current;

    const decorations = editor.deltaDecorations([], [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'bg-blue-500/10',
          glyphMarginClassName: 'ai-hint-glyph',
          hoverMessage: { value: `💡 **AI 助教提示**: ${message}` }
        }
      }
    ]);

    // 3秒后自动清除背景高亮，保留边栏图标
    setTimeout(() => {
      editor.deltaDecorations(decorations, [
        {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            glyphMarginClassName: 'ai-hint-glyph',
            hoverMessage: { value: `💡 **AI 助教提示**: ${message}` }
          }
        }
      ]);
    }, 3000);
  };

  // === 新增：处理反馈与求助人类教练（影子模式闭环） ===
  const submitFeedback = (index: number, isHelpful: boolean) => {
    setChatHistory(prev => {
      const newHistory = [...prev];
      // 标记该条消息已经评价过，隐藏按钮
      newHistory[index] = { ...newHistory[index], feedbackSubmitted: true };
      
      if (isHelpful) {
        newHistory.push({ role: 'system', content: '✅ 感谢反馈！系统已将这条高质量的 AI 引导记录入库，帮助系统进化。' });
      } else {
        newHistory.push({ 
          role: 'system', 
          content: '🚨 已触发求助工单！系统已将您的【题目ID】、【报错日志】、【当前代码】和【对话上下文】打包发送至主教练的钉钉/飞书。请稍候，人类老师将接管会话。' 
        });
      }
      return newHistory;
    });
  };

  // 自动滚动到最新消息
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isTyping]);

  // ==========================================
  // 3. 核心：封装包含“名师经验”的 AI 请求调用
  // ==========================================
  const callLLMAPI = async (userMessage: string, context: { mode: string, errorLog?: string, specificContext?: string }) => {
    setIsTyping(true);
    
    const { mode, errorLog, specificContext } = context;
    const teacherHint = TEACHER_KNOWLEDGE_BASE[MOCK_PROBLEM.id];
    const heuristic = GENERAL_DEBUGGING_HEURISTICS[mode as keyof typeof GENERAL_DEBUGGING_HEURISTICS] || "";
    
    // 针对运行时错误的 RAG 增强
    let ragInfo = "";
    if (mode === 'RE' && errorLog) {
      for (const [key, value] of Object.entries(COMMON_RUNTIME_ERRORS)) {
        if (errorLog.includes(key)) {
          ragInfo = `【知识库补充】：${key} 错误通常意味着：${value}`;
          break;
        }
      }
    }

    const systemInstruction = `
你是一位极其优秀的信奥 (OI) 竞赛教练，你深谙苏格拉底式教学法。
你的目标是启发学生独立思考，而不是做一台只会吐代码的机器。

【当前引导模式：${mode}】
${heuristic}

【基本原则】
1. 绝对不允许直接给出完整的正确代码！
2. 绝对不允许直接指出代码的具体某一行该怎么改。
3. 必须通过提问、反问、举反例的方式引导学生。

【当前题目环境】
题目ID：${MOCK_PROBLEM.id} | 标题：${MOCK_PROBLEM.title} | 限制：${MOCK_PROBLEM.constraints}

【名师锦囊（最高优先级指令！！！）】
${teacherHint ? `* 预判坑点：${teacherHint.pitfalls.join(' ')}\n* 引导策略：${teacherHint.teachingStrategy.join(' ')}` : "暂无特定锦囊，请使用通用启发式引导。"}

${ragInfo ? ragInfo : ""}

【学生状态上下文】
学生的当前代码：
\`\`\`cpp
${code}
\`\`\`
${errorLog ? `评测报错日志：\n\`\`\`\n${errorLog}\n\`\`\`` : ""}
特定的情境说明：${specificContext || "学生主动提问"}

请基于以上所有信息，回复学生的最新疑问。回复要简短有力，像一位真正的严师益友。
`;

    const apiKey = process.env.LLM_API_KEY;
    const baseURL = process.env.LLM_BASE_URL;
    const modelId = process.env.LLM_MODEL_ID ;

    if (!apiKey || !baseURL) {
      setIsTyping(false);
      setChatHistory(prev => [...prev, { role: 'assistant', content: '请配置 .env 中的 LLM_API_KEY 和 LLM_BASE_URL（如阿里云 DashScope）。' }]);
      return;
    }

    try {
      // 开发环境走 Vite 代理，避免 CORS；生产环境直连
      const useProxy = import.meta.env.DEV;
      const url = useProxy ? '/api/llm/chat/completions' : `${baseURL.replace(/\/$/, '')}/chat/completions`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!useProxy) headers['Authorization'] = `Bearer ${apiKey}`;

      // 先追加一条空内容的 assistant 消息，用于流式更新；并关闭“打字中”避免重复提示
      setChatHistory(prev => [...prev, { role: 'assistant', content: '' }]);
      setIsTyping(false);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userMessage },
          ],
          stream: true,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setChatHistory(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: '抱歉，助教开小差了，请稍后再试。' };
          return next;
        });
        return;
      }
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const chunk = json.choices?.[0]?.delta?.content;
                if (typeof chunk === 'string') {
                  flushSync(() => {
                    setChatHistory(prev => {
                      const next = [...prev];
                      const last = next[next.length - 1];
                      if (last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + chunk };
                      return next;
                    });
                  });
                }
              } catch (_) {}
            }
          }
        }
        // 若流结束仍无内容，补一句兜底
        setChatHistory(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role === 'assistant' && !last.content.trim()) next[next.length - 1] = { ...last, content: '抱歉，助教开小差了，请稍后再试。' };
          return next;
        });
      } catch (streamErr) {
        console.error("Stream Error:", streamErr);
        setChatHistory(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role === 'assistant' && !last.content.trim()) next[next.length - 1] = { ...last, content: '网络请求失败，请检查连接。' };
          return next;
        });
      }
    } catch (error) {
      console.error("AI Error:", error);
      setChatHistory(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.content === '') next[next.length - 1] = { ...last, content: "网络请求失败，请检查连接。" };
        else next.push({ role: 'assistant', content: "网络请求失败，请检查连接。" });
        return next;
      });
    } finally {
      setIsTyping(false);
    }
  };

  // 处理用户发送消息
  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    const msg = inputText.trim();
    setChatHistory(prev => [...prev, { role: 'user', content: msg }]);
    setInputText("");
    callLLMAPI(msg, { mode: 'GENERAL' });
  };

  // 主动请求提示
  const requestHint = () => {
    const msg = "老师，我对这道题有点没思路，你能给我一点方向性的提示吗？";
    setChatHistory(prev => [...prev, { role: 'user', content: msg }]);
    callLLMAPI("学生请求了一次思路提示。请根据教练经验，给出第一步的思考方向。", { mode: 'WA_ALGO', specificContext: "学生主动请求思路" });
  };

  // ==========================================
  // 4. 模拟的 OJ 评测逻辑 (拦截错误并触发教学)
  // ==========================================
  const mockSubmitCode = () => {
    setSubmissionResult('Running');
    
    setTimeout(() => {
      // 1. 模拟编译错误 (CE)
      const lines = code.split('\n');
      const missingSemicolonLine = lines.findIndex(line => line.includes('cout') && !line.includes(';'));
      
      if (missingSemicolonLine !== -1) {
        setSubmissionResult('CE');
        const errorLog = `error: expected ';' before 'return' at line ${missingSemicolonLine + 1}`;
        setChatHistory(prev => [...prev, { role: 'system', content: "🚨 评测结果：Compile Error (CE)。编译失败。" }]);
        
        // 在编辑器中添加视觉引导
        addEditorHint(missingSemicolonLine + 1, "编译器在这里附近感到困惑，检查一下是否漏掉了‘句号’？");

        callLLMAPI(
          `【系统内部指令】：学生提交了代码，结果为 CE。报错日志为：\`${errorLog}\`。请启动【翻译官模式】引导。`,
          { mode: 'CE', errorLog, specificContext: "学生遇到了编译错误" }
        );
        return;
      }

      // 2. 模拟运行时错误 (RE) - 简单检测数组越界
      if (code.includes('a[100]') || code.includes('a[1000]')) {
         setSubmissionResult('WA'); // 模拟为 RE 相关的引导
         const errorLog = "Runtime Error: Segmentation Fault (Core Dumped)";
         setChatHistory(prev => [...prev, { role: 'system', content: "🚨 评测结果：Runtime Error (RE)。程序异常终止。" }]);
         
         // 模拟可视化调试数据
         setDebugVariables({
           "index": 100,
           "array_size": 100,
           "status": "OUT_OF_BOUNDS"
         });

         callLLMAPI(
           `【系统内部指令】：学生提交了代码，结果为 RE。报错日志为：\`${errorLog}\`。请启动【侦探模式】引导。`,
           { mode: 'RE', errorLog, specificContext: "学生遇到了运行时错误" }
         );
         return;
      }

      // 3. 模拟逻辑错误 (WA) - 溢出问题
      if (code.includes('int a') || (code.includes('int main() {') && !code.includes('long long'))) {
        setSubmissionResult('WA');
        setChatHistory(prev => [...prev, { role: 'system', content: "🚨 评测结果：Wrong Answer (WA)。部分测试点未通过。" }]);
        
        // 模拟可视化调试数据
        setDebugVariables({
          "a": "10^18 (Overflow!)",
          "b": "10^18",
          "sum": "-1486618624 (Wrong!)"
        });

        callLLMAPI(
          "学生提交了代码，结果为 WA。请启动【推演家模式】引导，针对可能的数据溢出问题进行提问。",
          { mode: 'WA_LOGIC', specificContext: "学生遇到了逻辑错误（溢出）" }
        );
      } else if (code.includes('long long')) {
        setSubmissionResult('AC');
        setChatHistory(prev => [...prev, { role: 'system', content: "🎉 评测结果：Accepted (AC)！太棒了！" }]);
        setDebugVariables({
          "a": "1000000000000000000",
          "b": "1000000000000000000",
          "sum": "2000000000000000000 (Correct)"
        });
      } else {
         setSubmissionResult('WA');
      }
    }, 1500);
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans">
      {/* ================= 左侧：题目面板 ================= */}
      <div className="w-1/3 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700 bg-gray-800 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-bold">题目描述</h1>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div>
            <h2 className="text-2xl font-bold mb-2">{MOCK_PROBLEM.title}</h2>
            <div className="flex gap-2 mb-4">
              {MOCK_PROBLEM.tags.map(tag => (
                <span key={tag} className="px-2 py-1 text-xs bg-blue-900 text-blue-200 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-300 mb-2 border-b border-gray-700 pb-1">题目背景</h3>
            <p className="text-gray-300 leading-relaxed">{MOCK_PROBLEM.description}</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-300 mb-2 border-b border-gray-700 pb-1">输入输出格式</h3>
            <div className="bg-gray-800 p-3 rounded text-sm text-gray-300 space-y-2">
              <p><strong>输入：</strong> {MOCK_PROBLEM.inputFormat}</p>
              <p><strong>输出：</strong> {MOCK_PROBLEM.outputFormat}</p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-red-400 mb-2 border-b border-gray-700 pb-1">数据范围限制</h3>
            <p className="font-mono text-red-300 bg-red-900/20 p-2 rounded">{MOCK_PROBLEM.constraints}</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-300 mb-2 border-b border-gray-700 pb-1">样例</h3>
            {MOCK_PROBLEM.samples.map((sample, idx) => (
              <div key={idx} className="flex gap-4 mb-4">
                <div className="flex-1">
                  <div className="text-xs text-gray-400 mb-1">输入 #{idx+1}</div>
                  <pre className="bg-gray-800 p-2 rounded font-mono text-sm">{sample.input}</pre>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-400 mb-1">输出 #{idx+1}</div>
                  <pre className="bg-gray-800 p-2 rounded font-mono text-sm">{sample.output}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================= 右侧：工作区 ================= */}
      <div className="w-2/3 flex flex-col h-full overflow-hidden">
        
        {/* 上半部分：代码编辑器 + 调试面板 */}
        <div className="h-3/5 flex border-b border-gray-700 relative overflow-hidden">
          
          {/* 编辑器主体 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="p-2 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Code2 className="w-4 h-4" />
                <span>solution.cpp</span>
              </div>
              <button 
                onClick={mockSubmitCode}
                disabled={submissionResult === 'Running'}
                className={`flex items-center gap-1 px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  submissionResult === 'Running' 
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20'
                }`}
              >
                {submissionResult === 'Running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {submissionResult === 'Running' ? '评测中...' : '提交评测'}
              </button>
            </div>
            
            <div className="flex-1 relative">
              <Editor
                height="100%"
                defaultLanguage="cpp"
                value={code}
                onChange={(value) => setCode(value || "")}
                onMount={handleEditorDidMount}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 10 },
                  glyphMargin: true,
                  lineNumbersMinChars: 3,
                }}
              />
            </div>
          </div>

          {/* 侧边调试面板 */}
          <div className="w-64 border-l border-gray-700 bg-gray-850 p-3 hidden lg:flex flex-col gap-3">
            <VisualDebugger variables={debugVariables} />
            <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex flex-col h-40">
              <div className="bg-gray-800 px-3 py-2 border-b border-gray-700 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">终端输出 (Console)</span>
              </div>
              <div className="p-2 font-mono text-[10px] text-gray-400 overflow-y-auto">
                {submissionResult === 'Running' && <div className="animate-pulse">Compiling and running...</div>}
                {submissionResult === 'AC' && <div className="text-green-400">Test Case #1: OK (12ms)</div>}
                {submissionResult === 'WA' && <div className="text-red-400">Test Case #1: WA (Expected: 2000000000000000000, Got: -1486618624)</div>}
                {submissionResult === 'CE' && <div className="text-orange-400">Compilation failed. See AI hints.</div>}
              </div>
            </div>
          </div>

          {/* 评测结果浮层提示 */}
          {submissionResult === 'CE' && (
            <div className="absolute top-12 right-4 bg-orange-900/90 border border-orange-500 text-orange-200 px-4 py-3 rounded-lg flex items-start gap-3 shadow-xl animate-fade-in">
              <XCircle className="w-6 h-6 shrink-0 text-orange-400" />
              <div>
                <div className="font-bold">编译失败 (Compile Error)</div>
                <div className="text-sm mt-1">代码存在语法错误，编译器无法理解。看看助教的提示吧。</div>
              </div>
            </div>
          )}
          {submissionResult === 'WA' && (
            <div className="absolute top-12 right-4 bg-red-900/90 border border-red-500 text-red-200 px-4 py-3 rounded-lg flex items-start gap-3 shadow-xl animate-fade-in">
              <XCircle className="w-6 h-6 shrink-0 text-red-400" />
              <div>
                <div className="font-bold">评测未通过 (Wrong Answer)</div>
                <div className="text-sm mt-1">你的输出与标准答案不一致。AI 助教已在下方为你分析，去看看吧。</div>
              </div>
            </div>
          )}
          {submissionResult === 'AC' && (
            <div className="absolute top-12 right-4 bg-green-900/90 border border-green-500 text-green-200 px-4 py-3 rounded-lg flex items-start gap-3 shadow-xl animate-fade-in">
              <CheckCircle className="w-6 h-6 shrink-0 text-green-400" />
              <div>
                <div className="font-bold">恭喜通过 (Accepted)</div>
                <div className="text-sm mt-1">代码逻辑完全正确！</div>
              </div>
            </div>
          )}
        </div>

        {/* 下半部分：AI 助教聊天区 */}
        <div className="h-2/5 flex flex-col bg-gray-800">
          <div className="p-2 border-b border-gray-700 bg-gray-850 flex justify-between items-center shadow-sm z-10">
            <div className="flex items-center gap-2 text-sm text-blue-400 font-medium px-2">
              <MessageSquare className="w-4 h-4" />
              <span>AI 专属教练 (已注入经验)</span>
            </div>
            <button 
              onClick={requestHint}
              className="flex items-center gap-1 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-full text-gray-300 transition-colors"
            >
              <Lightbulb className="w-3 h-3 text-yellow-400" />
              请求方向提示
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                
                {/* 针对系统消息的特殊渲染 */}
                {msg.role === 'system' ? (
                   <div className="w-full flex justify-center my-2">
                     <span className={`text-xs px-3 py-1 rounded-full ${msg.content.includes('WA') ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
                       {msg.content}
                     </span>
                   </div>
                ) : (
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-none' 
                      : 'bg-gray-700 text-gray-100 rounded-bl-none shadow-md'
                  }`}>
                    {/* 使用新的 Markdown 渲染器代替原有的换行逻辑 */}
                    {msg.role === 'user' ? (
                      msg.content.split('\n').map((line, i) => (
                        <p key={i} className={i !== 0 ? "mt-2" : ""}>{line}</p>
                      ))
                    ) : (
                      <MarkdownRenderer content={msg.content} />
                    )}
                  </div>
                )}
                
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mt-1 ml-2">
                    <span className="text-[10px] text-gray-500">教练助手</span>
                    {!msg.feedbackSubmitted && (
                      <div className="flex gap-1 animate-fade-in">
                        <button onClick={() => submitFeedback(idx, true)} className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                          👍 有启发
                        </button>
                        <button onClick={() => submitFeedback(idx, false)} className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-red-900/60 text-gray-300 hover:text-red-300 transition-colors">
                          🙋‍♂️ 没听懂，求助人类老师
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            
            {isTyping && (
              <div className="flex items-start">
                <div className="bg-gray-700 rounded-2xl rounded-bl-none px-4 py-3 flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.15s'}}></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.3s'}}></div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-3 bg-gray-800 border-t border-gray-700">
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="告诉教练你的想法，或者询问错误原因..."
                className="w-full bg-gray-900 border border-gray-700 rounded-full py-2.5 pl-4 pr-12 text-sm text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button 
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isTyping}
                className="absolute right-2 p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
