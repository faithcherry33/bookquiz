import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, Legend, ResponsiveContainer, Cell
} from 'recharts';
import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  BookOpen, User, CheckCircle2, XCircle, ChevronRight, LogOut, ChevronDown, ChevronUp, Loader2, Sparkles, History, Settings, Plus, Trash2, Brain, Save, Edit3, AlertTriangle, KeyRound, Search, MessageSquareHeart, Lightbulb, Check, X, Trophy, MessageCircle, BellRing
} from 'lucide-react';

// --- Firebase & API 설정 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: 'AIzaSyBxxudMV5DJQ74sbJKmqCviwIMA30Jh-Jk',
      authDomain: 'bookquiz-da3d2.firebaseapp.com',
      projectId: 'bookquiz-da3d2',
      storageBucket: 'bookquiz-da3d2.firebasestorage.app',
      messagingSenderId: '879268657765',
      appId: '1:879268657765:web:750b214b2ba26c16aba48c',
      measurementId: 'G-PSMBS118EY',
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = 'my-reading-quiz-final';

const defaultQuizData = {};

const safeText = (val) => {
  if (val == null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

// ── 5단계 문해력 레벨 판별 함수 ──
const LEVELS = [
  {
    level: 1, name: '초보 독자', emoji: '🌱',
    color: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-200',
    desc: '글에 나온 사실을 찾는 연습을 하고 있어요.',
    next: '돋보기 질문에서 책에 나온 정확한 표현을 찾아 답해보세요.',
  },
  {
    level: 2, name: '기초 독자', emoji: '📖',
    color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200',
    desc: '글의 흐름과 인물 관계를 파악하고 있어요.',
    next: '탐정 질문에서 인물이 왜 그런 행동을 했는지 이유를 찾아 답해보세요.',
  },
  {
    level: 3, name: '발전 독자', emoji: '🔍',
    color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200',
    desc: '인물의 마음을 추론하기 시작했어요.',
    next: '탐정 질문에 답할 때 결론뿐 아니라 근거도 함께 써보세요. 질문을 만들 때 탐정 질문에 도전해보세요.',
  },
  {
    level: 4, name: '능동 독자', emoji: '🧠',
    color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200',
    desc: '인물의 마음을 논리적으로 추론하고 자신의 경험과 연결할 수 있어요.',
    next: '거울 질문에서 나의 경험과 책의 내용을 구체적으로 연결하고, 거울 질문을 스스로 만들어보세요.',
  },
  {
    level: 5, name: '탐험가 독자', emoji: '🏆',
    color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
    desc: '행간의 의미를 파악하고 창의적인 질문을 만들 수 있어요!',
    next: '최고 단계예요! 뒷 이야기를 상상하여 써 보거나 글을 읽으며 떠오른 새로운 주제에 대한 책을 찾아 읽어보세요.',
  },
];

const calcLevel = (records, questions) => {
  if (records.length === 0 && questions.length === 0) return null;

  // 유형별 정답률 계산
  const typeStats = { '돋보기': { correct: 0, total: 0 }, '탐정': { correct: 0, total: 0 }, '거울': { correct: 0, total: 0 } };
  records.forEach(r => {
    r.details?.forEach(d => {
      const t = d.questionType || '돋보기';
      if (typeStats[t]) { typeStats[t].total++; if (d.isCorrect) typeStats[t].correct++; }
    });
  });

  const rate = (type) => typeStats[type].total > 0
    ? typeStats[type].correct / typeStats[type].total : 0;

  const dotRate = rate('돋보기');
  const detRate = rate('탐정');
  const mirRate = rate('거울');

  // 출제 질문 유형 분석
  const qTypes = { '돋보기': 0, '탐정': 0, '거울': 0 };
  questions.forEach(q => { if (qTypes[q.type] !== undefined) qTypes[q.type]++; });
  const totalQs = questions.length;
  const detQRate = totalQs > 0 ? qTypes['탐정'] / totalQs : 0;
  const mirQRate = totalQs > 0 ? qTypes['거울'] / totalQs : 0;
  const hasApproved = questions.some(q => q.status === 'approved');

  // 단계 판별
  if (dotRate < 0.4 || records.length === 0) return 1;
  if (dotRate >= 0.4 && detRate < 0.3 && qTypes['탐정'] === 0) return 2;
  if (detRate >= 0.3 && detRate < 0.6 && detQRate < 0.3) return 3;
  if (detRate >= 0.6 && mirRate >= 0.3 && (detQRate >= 0.3 || hasApproved)) return 4;
  if (detRate >= 0.7 && mirRate >= 0.5 && mirQRate >= 0.2 && hasApproved) return 5;
  return 3; // 기본값
};

// 정밀한 시간 표시용 포맷
const formatDateTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${d.getHours()}시 ${String(d.getMinutes()).padStart(2, '0')}분`;
};

const formatDate = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
};

// 배열을 무작위로 섞는 셔플 함수
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// --- 공통 모달 컴포넌트 ---
const Modal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = "확인", cancelText = "취소", isAlert = false, customContent = null }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-black text-slate-800 mb-2">{title}</h3>
        {message && <p className="text-slate-600 font-medium mb-6 whitespace-pre-wrap leading-relaxed">{message}</p>}
        {customContent && <div className="mb-6">{customContent}</div>}
        <div className="flex gap-3 justify-end">
          {!isAlert && (
            <button onClick={onCancel} className="px-5 py-2.5 rounded-xl font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
              {cancelText}
            </button>
          )}
          <button onClick={onConfirm} className="px-5 py-2.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 질문 유형 메타데이터 ---
const QUESTION_TYPES = {
  '돋보기': { icon: <Search size={16} />, color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-200', desc: '책에 답이 명확히 나와있는 사실 확인 질문' },
  '탐정': { icon: <Brain size={16} />, color: 'text-purple-600', bg: 'bg-purple-100', border: 'border-purple-200', desc: '단서를 모아 숨겨진 의미를 추리하는 질문' },
  '거울': { icon: <MessageSquareHeart size={16} />, color: 'text-rose-600', bg: 'bg-rose-100', border: 'border-rose-200', desc: '나의 삶이나 생각과 연결짓는 적용 질문' },
};

export default function App() {
  const [userName, setUserName] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  
  const [dbError, setDbError] = useState(false); 
  const [authError, setAuthError] = useState(false);

  const [stage, setStage] = useState('home');
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedChapter, setSelectedChapter] = useState(null);

  const [quizDataState, setQuizDataState] = useState({});
  const [currentQuestions, setCurrentQuestions] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  
  const [isGrading, setIsGrading] = useState(false);
  const [quizPhase, setQuizPhase] = useState(0); // 0:돋보기 1:탐정 2:거울
  const [phaseQuestions, setPhaseQuestions] = useState([[], [], []]);
  const [phaseResults, setPhaseResults] = useState([[], [], []]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [allRecords, setAllRecords] = useState([]);
  const [studentQuestions, setStudentQuestions] = useState([]);
  const [teacherTab, setTeacherTab] = useState('records');

  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', isAlert: true, onConfirm: () => {} });

  const showAlert = (title, message) => {
    setModalConfig({ isOpen: true, title, message, isAlert: true, onConfirm: () => setModalConfig({ isOpen: false }) });
  };

  const showConfirm = (title, message, onConfirm) => {
    setModalConfig({
      isOpen: true, title, message, isAlert: false,
      onConfirm: () => { onConfirm(); setModalConfig({ isOpen: false }); },
      onCancel: () => setModalConfig({ isOpen: false })
    });
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error('인증 실패:', error);
        if (error.code === 'auth/operation-not-allowed') setAuthError(true);
      }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, setCurrentUser);
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const recordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'reading_quiz_logs');
    const unsubscribeRecords = onSnapshot(recordsRef, (snapshot) => {
        const records = [];
        snapshot.forEach((doc) => records.push({ id: doc.id, ...doc.data() }));
        records.sort((a, b) => b.timestamp - a.timestamp);
        setAllRecords(records);
        setDbError(false);
      }, (err) => {
        if (err.code === 'permission-denied') setDbError(true);
      });

    const quizConfigRef = collection(db, 'artifacts', appId, 'public', 'data', 'quiz_config');
    const unsubscribeQuiz = onSnapshot(quizConfigRef, async (snapshot) => {
        let loadedData = {};
        let hasData = false;
        snapshot.forEach((doc) => {
          if (doc.id === 'main_data') { loadedData = doc.data().quizData; hasData = true; }
        });

        if (!hasData) {
          try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'quiz_config', 'main_data');
            if (Object.keys(defaultQuizData).length > 0) {
              await setDoc(docRef, { quizData: defaultQuizData });
              setQuizDataState(defaultQuizData);
            }
          } catch (e) {
            if (e.code === 'permission-denied') setDbError(true);
          }
        } else {
          // 안전장치: loadedData가 undefined이거나 빈 객체이면 state를 업데이트하지 않음
          if (loadedData && Object.keys(loadedData).length > 0) {
            setQuizDataState(loadedData);
          } else {
            console.warn('⚠️ Firebase에서 빈 데이터가 감지되어 state 업데이트를 건너뜁니다.');
          }
        }
        setIsLoadingData(false);
      }, (err) => {
        setIsLoadingData(false);
        if (err.code === 'permission-denied') setDbError(true);
      });

    const studentQRef = collection(db, 'artifacts', appId, 'public', 'data', 'student_questions');
    const unsubscribeStudentQ = onSnapshot(studentQRef, (snapshot) => {
      const qList = [];
      snapshot.forEach((doc) => qList.push({ id: doc.id, ...doc.data() }));
      qList.sort((a, b) => b.timestamp - a.timestamp);
      setStudentQuestions(qList);
    });

    return () => {
      unsubscribeRecords();
      unsubscribeQuiz();
      unsubscribeStudentQ();
    };
  }, [currentUser]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (userName.trim() === '') return;
    setIsTeacher(userName.trim() === '선생님');
    setIsLoggedIn(true);
    setStage('home');
  };

  const handleLogout = () => {
    setUserName('');
    setIsLoggedIn(false);
    setIsTeacher(false);
    resetQuiz();
  };

  const resetQuiz = () => {
    setSelectedBook(null);
    setSelectedChapter(null);
    setCurrentQuestions([]);
    setUserAnswers({});
    setQuizResult(null);
    setIsGrading(false);
    setQuizPhase(0);
    setPhaseQuestions([[], [], []]);
    setPhaseResults([[], [], []]);
    setStage('home');
  };

  const startQuiz = (book, chapter) => {
    const chapterData = quizDataState[book]?.[chapter];
    if (!chapterData) return;
  
    const rawQuestions = Array.isArray(chapterData)
      ? chapterData
      : chapterData.questions || [];
  
    const settings = Array.isArray(chapterData)
      ? { quota: { '돋보기': 5, '탐정': 3, '거울': 2 }, total: 10 }
      : chapterData.settings || { quota: { '돋보기': 5, '탐정': 3, '거울': 2 }, total: 10 };
  
    if (rawQuestions.length === 0) {
      showAlert('알림', '선생님이 아직 이 챕터에 퀴즈를 등록하지 않으셨어요!');
      return;
    }
  
    const quota = settings.quota || { '돋보기': 5, '탐정': 3, '거울': 2 };
  
    const byType = { '돋보기': [], '탐정': [], '거울': [] };
    rawQuestions.forEach(q => {
      const t = q.type || '돋보기';
      if (byType[t]) byType[t].push(q);
    });
  
    const groups = ['돋보기', '탐정', '거울'].map(type => {
      return shuffleArray(byType[type] || []).slice(0, quota[type] || 0);
    });
  
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setPhaseQuestions(groups);
    setPhaseResults([[], [], []]);
    setUserAnswers({});
    setQuizPhase(0);
    setCurrentQuestions(groups[0]);
    setStage('quiz');
  };

  const startCreatingQuestion = (book, chapter) => {
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setStage('create_question');
  };

  const handleAnswerInput = (qIndex, text) => {
    setUserAnswers((prev) => ({ ...prev, [qIndex]: text }));
  };

  const submitQuiz = async () => {
    setIsGrading(true);
    try {
      const chapterData = quizDataState[selectedBook]?.[selectedChapter];
      const synopsis = Array.isArray(chapterData) ? '' : chapterData?.synopsis || '';
  
      const phaseNames = ['돋보기', '탐정', '거울'];
      const currentPhaseName = phaseNames[quizPhase];
  
      const promptText = `
      당신은 초등학교 학생들의 독서 퀴즈를 채점하는 꼼꼼하고 다정한 선생님입니다.
      현재 채점하는 문항은 모두 [${currentPhaseName}] 유형입니다.
      ${synopsis ? `\n[이 챕터의 줄거리 - 채점 시 반드시 참고하세요]\n${synopsis}\n` : ''}
      [${currentPhaseName} 유형 채점 기준]
      ${currentPhaseName === '돋보기' ? `
      - 책에 명시된 사건과 맥락이 일치하는지 확인하세요.
      - 고유명사, 병명, 지명, 인물명 등 명료한 용어가 요구되는 경우에는 완전히 일치해야 정답입니다.
      - 오답 피드백: 모범 정답을 직접 알려주지 말고, 책의 어떤 내용이 나오는 부분을 다시 찾아보면 되는지 힌트를 주세요.` : ''}
      ${currentPhaseName === '탐정' ? `
      - 학생의 답변에 논리적 근거가 되는 부분들이 함께 제시되어 있는지 확인하세요.
      - 결론만 있고 근거가 없거나, 근거가 결론과 논리적으로 연결되지 않으면 오답입니다.
      - 오답 피드백: 어느 부분의 논리적 연결이 부족한지 구체적으로 지적하고, 어떤 근거를 책에서 찾아야 하는지 방향을 제시하세요.` : ''}
      ${currentPhaseName === '거울' ? `
      - 학생이 자신의 경험과 연결했는지, 그 이유가 구체적으로 제시되어 있는지 확인하세요.
      - 학생의 경험이 질문에서 요구하는 유형과 관련이 없다면 오답입니다.
      - 오답 피드백: 어떤 유형의 경험과 연관지어야 하는지 구체적으로 안내하세요.
      - 경험과 이유가 모두 있고 질문과 관련이 있다면 표현이 다소 부족해도 정답(true)으로 인정하세요.` : ''}
      
      [채점 대상]
      ${currentQuestions.map((q, i) =>
        `문제 ${i + 1}: ${safeText(q.q)}
      모범 정답: ${safeText(q.a)}
      학생 답변: ${safeText(userAnswers[i] || '답변 없음')}`
      ).join('\n\n')}
      
      반드시 아래 JSON 형식으로만 응답하세요.
      { "results": [ { "isCorrect": true 또는 false, "feedback": "피드백 내용" } ] }
      `;
  
      const response = await fetch(`/.netlify/functions/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, responseFormat: 'application/json' }),
      });
  
      const data = await response.json();
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!resultText) throw new Error('AI 채점 실패');
  
      const cleanText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
      const aiResponse = JSON.parse(cleanText);
  
      const currentDetails = currentQuestions.map((q, idx) => {
        const grading = aiResponse.results[idx] || { isCorrect: false, feedback: '채점 오류가 발생했습니다.' };
        return {
          questionText: safeText(q.q),
          questionType: q.type || '돋보기',
          correctAnswer: safeText(q.a),
          userAnswer: safeText(userAnswers[idx] || '미입력'),
          isCorrect: grading.isCorrect,
          feedback: safeText(grading.feedback),
        };
      });
  
      // 현재 단계 결과 저장
      const newPhaseResults = [...phaseResults];
      newPhaseResults[quizPhase] = currentDetails;
  
      // 다음 단계 찾기 (문항이 있는 단계로)
      let nextPhase = quizPhase + 1;
      while (nextPhase < 3 && phaseQuestions[nextPhase].length === 0) {
        nextPhase++;
      }
  
      if (nextPhase < 3) {
        // 다음 단계로 이동
        setPhaseResults(newPhaseResults);
        setQuizPhase(nextPhase);
        setCurrentQuestions(phaseQuestions[nextPhase]);
        setUserAnswers({});
        setStage('phase_result'); // 단계별 결과 화면
      } else {
        // 모든 단계 완료 → 최종 저장
        const allDetails = newPhaseResults.flat();
        const score = allDetails.filter(d => d.isCorrect).length;
        const total = allDetails.length;
  
        if (currentUser) {
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'reading_quiz_logs'), {
            studentName: userName,
            book: selectedBook,
            chapter: selectedChapter,
            score,
            total,
            timestamp: Date.now(),
            dateString: new Date().toLocaleString(),
            details: allDetails,
          });
        }
  
        setPhaseResults(newPhaseResults);
        setQuizResult({ score, total, details: allDetails });
        setStage('result');
      }
    } catch (error) {
      console.error('채점 중 오류 발생:', error);
      setIsGrading(false);
      setStage('quiz_error');
    } finally {
      setIsGrading(false);
    }
  };

  const myRecords = allRecords.filter((r) => r.studentName === userName);
  const myAllQuestions = studentQuestions.filter(q => q.studentName === userName);
  const myApprovedQuestions = myAllQuestions.filter(q => q.status === 'approved');
  
  const unreadMessages = myAllQuestions.filter(q => q.teacherComment && q.isReadByStudent === false);

  const handleReadMessage = async (msg) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_questions', msg.id), { isReadByStudent: true });
      
      const typeMeta = QUESTION_TYPES[msg.type] || QUESTION_TYPES['돋보기'];
      setModalConfig({
        isOpen: true,
        title: '선생님의 메시지 도착 💌',
        isAlert: true,
        confirmText: "확인했어요",
        onConfirm: () => setModalConfig({ isOpen: false }),
        customContent: (
          <div className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex gap-2 mb-2">
                <span className="text-xs font-black bg-white text-slate-600 px-2 py-0.5 rounded border border-slate-200">{msg.book} &gt; {msg.chapter}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${typeMeta.bg} ${typeMeta.color}`}>{msg.type} 질문</span>
              </div>
              <p className="font-bold text-slate-700 text-sm">Q. {msg.question}</p>
            </div>
            <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-100">
              <div className="flex items-center gap-2 mb-2">
                <User size={18} className="text-indigo-600" />
                <span className="font-black text-indigo-800 text-sm">선생님의 한마디</span>
              </div>
              <p className="font-bold text-indigo-900 text-base leading-relaxed whitespace-pre-wrap">{msg.teacherComment}</p>
            </div>
          </div>
        )
      });
    } catch (e) {
      console.error(e);
    }
  };

  // --- 에러 스크린 ---
  if (authError) return <ErrorScreen title="익명 로그인 기능 꺼짐" msg="Firebase 콘솔에서 익명 로그인을 켜주세요." Icon={KeyRound} color="orange" />;
  if (dbError) return <ErrorScreen title="데이터베이스 권한 잠김" msg="Firestore 규칙을 테스트 모드로 변경해주세요." Icon={AlertTriangle} color="rose" />;

  // --- 로그인 화면 ---
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center p-4 font-sans text-slate-800">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border-4 border-sky-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-sky-300 via-blue-400 to-indigo-400"></div>
          <div className="flex justify-center mb-6 mt-4">
            <div className="bg-yellow-100 p-5 rounded-full text-yellow-500 relative shadow-inner">
              <BookOpen size={48} />
              <Sparkles size={28} className="absolute -top-2 -right-2 text-yellow-400 animate-bounce" />
            </div>
          </div>
          <h1 className="text-3xl font-black text-center mb-3 text-slate-800">📚 AI 독서 퀴즈 탐험대</h1>
          <p className="text-slate-600 text-center mb-8 font-medium bg-sky-50 py-3 rounded-xl">
            AI 선생님이 얼마나 책을 잘 이해했는지 알려줄거예요.<br />
            <strong>자신의 성과 이름을 정확하게</strong> 입력하세요.
          </p>
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User size={20} className="text-slate-400" />
              </div>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="pl-12 w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:ring-4 focus:ring-sky-200 focus:border-sky-400 outline-none transition-all font-bold text-lg"
                placeholder="이름 적기 (예: 홍길동)"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoadingData}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center text-lg disabled:opacity-50"
            >
              {isLoadingData ? <Loader2 className="animate-spin" /> : <>퀴즈 풀러 들어가기 <ChevronRight size={24} className="ml-2" /></>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- 선생님 대시보드 ---
  if (isTeacher) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800 pb-20">
        <Modal {...modalConfig} />
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-100 p-3 rounded-xl text-indigo-600"><Settings size={28} /></div>
              <div>
                <h1 className="text-xl font-bold">선생님 전용 대시보드</h1>
                <p className="text-sm text-slate-500">학생들의 문해력 파악 및 퀴즈 관리</p>
              </div>
            </div>
            <button onClick={handleLogout} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-medium flex items-center transition-colors">
              <LogOut size={16} className="mr-2" /> 나가기
            </button>
          </div>

          <div className="flex gap-2 mb-6 flex-wrap">
            <button onClick={() => setTeacherTab('records')} className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all min-w-[140px] ${teacherTab === 'records' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
              <History size={18} /> 학생 이해도 5차원 진단
            </button>
            <button onClick={() => setTeacherTab('manage')} className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all min-w-[140px] ${teacherTab === 'manage' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
              <Edit3 size={18} /> 독서 퀴즈 문제 관리
            </button>
            <button onClick={() => setTeacherTab('approve')} className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all min-w-[140px] ${teacherTab === 'approve' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
              <Lightbulb size={18} /> 학생 질문 채택하기
            </button>
            <button onClick={() => setTeacherTab('report')}
              className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all min-w-[140px] ${
                teacherTab === 'report' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}>
              <Brain size={18} /> 문해력 성장 리포트
            </button>
          </div>

          {teacherTab === 'records' && <TeacherRecordsTab allRecords={allRecords} studentQuestions={studentQuestions} db={db} appId={appId} />}
          {teacherTab === 'manage' && <TeacherManageTab quizDataState={quizDataState} db={db} appId={appId} showConfirm={showConfirm} showAlert={showAlert} />}
          {teacherTab === 'approve' && <TeacherApproveTab studentQuestions={studentQuestions} quizDataState={quizDataState} db={db} appId={appId} showAlert={showAlert} showConfirm={showConfirm} />}
          {teacherTab === 'report' && <TeacherReportTab allRecords={allRecords} studentQuestions={studentQuestions} db={db} appId={appId} />}
        </div>
      </div>
    );
  }

  // --- 학생 공통 헤더 ---
  const StudentHeader = () => (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex items-center gap-3">
        <div className="bg-sky-100 p-2.5 rounded-xl text-sky-600"><User size={22} /></div>
        <div>
          <span className="font-black text-lg block text-slate-700">{safeText(userName)} 탐험대원</span>
          <div className="flex gap-2 mt-1">
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md font-medium">퀴즈 완료: {myRecords.length}번</span>
            <span className="text-xs text-purple-600 bg-purple-100 px-2 py-1 rounded-md font-bold">내가 낸 퀴즈: {myAllQuestions.length}건</span>
            {myApprovedQuestions.length > 0 && (
              <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded-md font-bold flex items-center gap-1">
                <Trophy size={12}/> 공식 출제자
              </span>
            )}
          </div>
        </div>
      </div>
      <button onClick={handleLogout} className="text-slate-500 hover:text-slate-800 flex items-center text-sm font-bold bg-slate-50 hover:bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 transition-colors">
        <LogOut size={16} className="mr-1" /> 처음으로
      </button>
    </div>
  );

  // --- 학생 메인 홈 ---
  if (stage === 'home') {
    return (
      <div className="min-h-screen bg-sky-50/50 p-4 md:p-8 font-sans text-slate-800 pb-20">
        <Modal {...modalConfig} />
        <div className="max-w-4xl mx-auto">
          <StudentHeader />
          
          {/* 새 메시지 알림 영역 */}
          {unreadMessages.length > 0 && (
            <div className="mb-6 space-y-3 animate-in slide-in-from-top-4">
              {unreadMessages.map(msg => (
                <button key={msg.id} onClick={() => handleReadMessage(msg)} className="w-full bg-indigo-50 border-2 border-indigo-200 p-4 rounded-2xl flex items-center justify-between hover:bg-indigo-100 transition-colors text-left shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-500 p-2 rounded-full text-white animate-pulse"><BellRing size={20}/></div>
                    <span className="font-black text-indigo-900 text-[15px]">
                      {msg.book} - {msg.chapter}에서 제안한 질문에 선생님의 메시지가 도착했어요!
                    </span>
                  </div>
                  <ChevronRight className="text-indigo-400" />
                </button>
              ))}
            </div>
          )}

          {/* 자동 로드되는 오늘의 AI 맞춤 코칭 */}
          <StudentDailyAdvice myRecords={myRecords} myQuestions={myAllQuestions} userName={userName} />
              
          {/* 내 문해력 단계 카드 */}
          <StudentLevelCard records={myRecords} questions={myAllQuestions} />

          <div className="text-center mb-8 mt-4">
            <h2 className="text-3xl font-black text-slate-800 mb-3">어떤 책의 퀴즈를 풀어볼까요? 🤔</h2>
            <p className="text-slate-500 font-medium">원하는 책과 장을 선택해서 퀴즈도 풀고 질문도 만들어보세요!</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {Object.keys(quizDataState).map((bookName) => {
              const bookRecords = myRecords.filter(r => r.book === bookName);
              const lastRecord = bookRecords.length > 0 ? bookRecords[0] : null;

              return (
              <div key={bookName} className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border-2 border-slate-100 hover:border-sky-300 transition-all hover:shadow-md">
                <div className="flex items-center gap-3 mb-2 bg-slate-50 p-4 rounded-2xl">
                  <BookOpen className="text-sky-500 shrink-0" size={32} />
                  <h3 className="text-2xl font-black text-slate-800 break-keep">{safeText(bookName)}</h3>
                </div>
                
                {lastRecord ? (
                   <p className="text-xs font-bold text-slate-400 mb-6 px-2">
                     마지막 학습: {formatDate(lastRecord.timestamp)} (최근 {lastRecord.chapter})
                   </p>
                ) : (
                   <p className="text-xs font-bold text-slate-400 mb-6 px-2">아직 학습 기록이 없어요.</p>
                )}

                <div className="space-y-3">
                {Object.keys(quizDataState[bookName]).sort((a, b) => {
                  const numA = parseInt(a.match(/\d+/)?.[0] ?? '9999');
                  const numB = parseInt(b.match(/\d+/)?.[0] ?? '9999');
                  if (numA !== numB) return numA - numB;
                  return a.localeCompare(b, 'ko');
                }).map((chapterName) => {

                    const hasDoneChapter = myRecords.some(r => r.book === bookName && r.chapter === chapterName);
                    const chapterDate = hasDoneChapter ? formatDate(myRecords.find(r => r.book === bookName && r.chapter === chapterName).timestamp) : null;
                    
                    return (
                    <div key={chapterName} className="flex gap-2 w-full items-stretch">
                      <button onClick={() => startQuiz(bookName, chapterName)} className="flex-1 text-left px-5 py-4 rounded-2xl border-2 border-slate-100 hover:border-blue-400 hover:bg-blue-50 flex flex-col justify-center transition-all group relative">
                        <span className="font-bold text-slate-600 group-hover:text-blue-700 text-lg flex items-center gap-2">
                          <Sparkles size={18} className="text-yellow-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          {safeText(chapterName)}
                        </span>
                        {hasDoneChapter && (
                          <span className="text-[10px] font-bold text-blue-400 mt-1 block">완료: {chapterDate}</span>
                        )}
                        <ChevronRight size={24} className="text-slate-300 group-hover:text-blue-600 absolute right-4 top-1/2 -translate-y-1/2 transform group-hover:translate-x-1 transition-transform" />
                      </button>
                      <button onClick={() => startCreatingQuestion(bookName, chapterName)} className="w-16 flex flex-col items-center justify-center rounded-2xl border-2 border-slate-100 hover:border-rose-400 hover:bg-rose-50 transition-all text-slate-400 hover:text-rose-600" title="내가 퀴즈 내기">
                        <Lightbulb size={24} />
                      </button>
                    </div>
                  )})}
                </div>
              </div>
            )})}
            {Object.keys(quizDataState).length === 0 && (
              <div className="col-span-2 text-center py-12 text-slate-400 font-medium bg-white rounded-3xl border-2 border-dashed border-slate-200">
                선생님이 아직 퀴즈를 등록하지 않으셨어요!
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- 학생 질문 만들기 (폼 & 결과 일체형 탭) ---
  if (stage === 'create_question') {
    return <StudentCreateQuestionTab 
      book={selectedBook} 
      chapter={selectedChapter} 
      userName={userName} 
      db={db} 
      appId={appId} 
      teacherQuestions={quizDataState[selectedBook]?.[selectedChapter] || []} 
      onClose={() => setStage('home')} 
      showAlert={showAlert}
    />;
  }

// --- 단계별 결과 화면 ---
if (stage === 'phase_result') {
  const phaseNames = ['돋보기', '탐정', '거울'];
  const phaseEmojis = ['🔍', '🧠', '💬'];
  const currentPhaseName = phaseNames[quizPhase - 1];
  const currentPhaseEmoji = phaseEmojis[quizPhase - 1];
  const currentPhaseDetails = phaseResults[quizPhase - 1] || [];
  const correctCount = currentPhaseDetails.filter(d => d.isCorrect).length;
  const nextPhaseName = phaseNames[quizPhase];
  const nextPhaseEmoji = phaseEmojis[quizPhase];

  return (
    <div className="min-h-screen bg-sky-50/50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-3xl mx-auto">

        {/* 단계 진행 표시 */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {['돋보기', '탐정', '거울'].map((name, i) => (
            <div key={name} className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-black text-sm ${
                i < quizPhase
                  ? 'bg-green-100 text-green-700'
                  : i === quizPhase
                  ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300'
                  : 'bg-slate-100 text-slate-400'
              }`}>
                {i < quizPhase ? '✓' : phaseEmojis[i]} {name}
              </div>
              {i < 2 && <span className="text-slate-300 font-bold">→</span>}
            </div>
          ))}
        </div>

        {/* 이번 단계 결과 요약 */}
        <div className="bg-white rounded-3xl p-8 text-center mb-8 border border-slate-200 shadow-sm">
          <div className="text-5xl mb-4">{currentPhaseEmoji}</div>
          <h2 className="text-2xl font-black text-slate-800 mb-2">
            {currentPhaseName} 단계 완료!
          </h2>
          <p className="text-slate-500 font-medium mb-4">
            {currentPhaseDetails.length}문제 중 {correctCount}문제 정답
          </p>
          <div className="flex justify-center gap-2">
            {currentPhaseDetails.map((d, i) => (
              <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-black ${
                d.isCorrect ? 'bg-green-400' : 'bg-rose-400'
              }`}>
                {d.isCorrect ? '○' : '✕'}
              </div>
            ))}
          </div>
        </div>

        {/* 이번 단계 피드백 */}
        <div className="space-y-4 mb-8">
          {currentPhaseDetails.map((item, idx) => {
            const typeMeta = QUESTION_TYPES[item.questionType] || QUESTION_TYPES['돋보기'];
            return (
              <div key={idx} className={`p-5 rounded-2xl border-2 ${item.isCorrect ? 'border-green-200 bg-white' : 'border-rose-200 bg-white'}`}>
                <div className="flex items-start gap-3 mb-4">
                  <div className={`p-2 rounded-xl shrink-0 ${item.isCorrect ? 'bg-green-100 text-green-600' : 'bg-rose-100 text-rose-500'}`}>
                    {item.isCorrect ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                  </div>
                  <p className="font-black text-slate-800 leading-relaxed">Q. {safeText(item.questionText)}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl mb-3 border border-slate-100">
                  <span className="text-xs font-black text-slate-400 block mb-1 flex items-center gap-1"><User size={12}/> 내가 적은 답</span>
                  <p className="text-slate-700 font-bold text-sm">{safeText(item.userAnswer)}</p>
                </div>
                <div className={`p-4 rounded-xl flex gap-3 ${item.isCorrect ? 'bg-green-50 border border-green-100' : 'bg-orange-50 border border-orange-100'}`}>
                  <Sparkles size={16} className={`shrink-0 mt-0.5 ${item.isCorrect ? 'text-green-500' : 'text-orange-500'}`} />
                  <p className={`font-bold text-sm leading-relaxed ${item.isCorrect ? 'text-green-900' : 'text-orange-900'}`}>
                    {safeText(item.feedback)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 다음 단계로 버튼 */}
        <div className="flex justify-center pb-12">
          <button
            onClick={() => {
              setStage('quiz');
            }}
            className="py-5 px-14 rounded-2xl font-black text-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl transition-all flex items-center gap-3"
          >
            {nextPhaseEmoji} {nextPhaseName} 질문 풀러 가기 →
          </button>
        </div>
      </div>
    </div>
  );
}

  // --- 학생 퀴즈 풀기 화면 ---
  if (stage === 'quiz_error') {
    return (
      <div className="min-h-screen bg-sky-50 flex flex-col items-center justify-center p-4 text-center">
        <div className="bg-white p-8 rounded-3xl shadow-lg border border-sky-100 max-w-sm w-full">
          <div className="text-5xl mb-4">😓</div>
          <h2 className="text-xl font-black text-slate-800 mb-3">AI 선생님이 잠깐 바빠요</h2>
          <p className="text-slate-500 font-medium mb-6">잠시 후 다시 시도해주세요.</p>
          <button
            onClick={() => { setStage('quiz'); }}
            className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white font-black rounded-2xl shadow-lg transition-all"
          >
            다시 시도하기
          </button>
          <button
            onClick={resetQuiz}
            className="w-full py-3 mt-3 bg-slate-100 text-slate-600 font-bold rounded-2xl"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'quiz') {
    if (isGrading) {
      return <GradingScreen />;
    }
    const answeredCount = Object.keys(userAnswers).filter((k) => userAnswers[k]?.trim() !== '').length;
    return (
      <div className="min-h-screen bg-sky-50/50 p-4 md:p-8 font-sans text-slate-800 pb-32">
        <Modal {...modalConfig}/>
        <div className="max-w-3xl mx-auto">
        <div className="mb-6 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* 단계 진행 바 */}
        <div className="flex border-b border-slate-100">
          {[{name: '돋보기', emoji: '🔍'}, {name: '탐정', emoji: '🧠'}, {name: '거울', emoji: '💬'}].map((phase, i) => (
            <div key={phase.name} className={`flex-1 py-2.5 text-center text-xs font-black transition-all ${
              i < quizPhase
                ? 'bg-green-50 text-green-600'
                : i === quizPhase
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-400'
                : 'text-slate-300'
            }`}>
              {i < quizPhase ? '✓' : phase.emoji} {phase.name}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <span className="bg-sky-100 text-sky-800 font-black px-4 py-1.5 rounded-xl text-sm">{safeText(selectedBook)}</span>
            <span className="text-slate-300 font-bold">›</span>
            <span className="bg-slate-100 text-slate-700 font-black px-4 py-1.5 rounded-xl text-sm">{safeText(selectedChapter)}</span>
          </div>
          <button onClick={resetQuiz} className="text-sm font-bold text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 px-4 py-2 rounded-xl transition-colors">그만 풀기</button>
          </div>
        </div>
          <div className="space-y-6">
            {currentQuestions.map((q, qIndex) => {
              const qType = q.type || '돋보기';
              const typeMeta = QUESTION_TYPES[qType] || QUESTION_TYPES['돋보기'];
              return (
                <div key={qIndex} className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-50">
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-black flex items-center gap-1 ${typeMeta.bg} ${typeMeta.color}`}>
                      {typeMeta.icon} {qType} 질문
                    </span>
                    {q.createdBy && <span className="text-xs font-bold text-slate-400 flex items-center gap-1"><User size={12}/> {q.createdBy} 대원 출제</span>}
                  </div>
                  <h3 className="text-lg md:text-xl font-black mb-5 leading-relaxed flex gap-3 text-slate-800">
                    <span className="bg-sky-100 text-sky-600 px-3 py-1 rounded-xl shrink-0 h-fit">Q{qIndex + 1}</span>
                    {safeText(q.q)}
                  </h3>
                  <textarea
                    value={userAnswers[qIndex] || ''}
                    onChange={(e) => handleAnswerInput(qIndex, e.target.value)}
                    placeholder="여기에 내 생각을 자유롭게 적어보세요..."
                    className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-sky-400 focus:bg-white outline-none transition-all resize-y min-h-[120px] text-base md:text-lg font-medium"
                  />
                </div>
              );
            })}
          </div>
          <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-4 z-10">
            <div className="max-w-3xl mx-auto flex justify-between items-center">
              <div className="text-sm font-bold text-slate-600 bg-slate-100 px-5 py-3 rounded-xl flex gap-2">
                <span className="text-sky-600 text-lg">{answeredCount}</span> / {currentQuestions.length}개 작성함
              </div>
              <button
                onClick={submitQuiz}
                disabled={answeredCount === 0}
                className={`px-8 py-4 rounded-2xl font-black text-lg transition-all flex items-center gap-2 ${answeredCount > 0 ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg' : 'bg-slate-200 text-slate-400'}`}
              >
                <Sparkles size={20} /> 다 풀었어요!
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- 학생 퀴즈 결과 확인 ---
  if (stage === 'result') {
    const hasSubmittedQuestion = myAllQuestions.some(q => q.book === selectedBook && q.chapter === selectedChapter);

    return (
      <div className="min-h-screen bg-sky-50/50 p-4 md:p-8 font-sans text-slate-800">
        <div className="max-w-3xl mx-auto">
          <StudentHeader />
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-8 text-center mb-10">
            <h2 className="text-2xl font-black mb-3 text-slate-800">수고했어요! 멋진 생각들이네요.</h2>
            <p className="text-blue-600 font-bold bg-blue-50 inline-flex items-center gap-2 px-6 py-3 rounded-2xl mt-4">
              <CheckCircle2 size={18} /> 소중한 내 기록이 선생님께 안전하게 전달되었어요!
            </p>
          </div>
          
          <div className="space-y-6 mb-16">
            <h3 className="font-black text-xl px-2 flex items-center gap-2 text-slate-700">
              <Sparkles className="text-yellow-500" /> 작성한 답변과 AI 피드백
            </h3>
            {quizResult.details.map((item, idx) => {
              const typeMeta = QUESTION_TYPES[item.questionType] || QUESTION_TYPES['돋보기'];
              return (
              <div key={idx} className={`p-6 md:p-8 rounded-3xl border-2 ${item.isCorrect ? 'bg-white border-green-200' : 'bg-white border-rose-200'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-black flex items-center gap-1 ${typeMeta.bg} ${typeMeta.color}`}>
                    {typeMeta.icon} {item.questionType}
                  </span>
                </div>
                <div className="flex items-start gap-4 mb-5 pb-5 border-b-2 border-slate-50">
                  <div className={`mt-1 p-3 rounded-2xl ${item.isCorrect ? 'bg-green-100 text-green-600' : 'bg-rose-100 text-rose-500'}`}>
                    {item.isCorrect ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
                  </div>
                  <div>
                    <p className="font-black text-slate-800 leading-relaxed text-lg">Q. {safeText(item.questionText)}</p>
                  </div>
                </div>
                <div className="pl-0 md:pl-16 space-y-4">
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                    <span className="text-sm font-black text-slate-400 block mb-2 flex items-center gap-1"><User size={14} /> 내가 적은 답</span>
                    <p className="text-slate-700 font-bold whitespace-pre-wrap leading-relaxed">{safeText(item.userAnswer)}</p>
                  </div>
                  <div className={`p-5 rounded-2xl flex gap-3 ${item.isCorrect ? 'bg-green-50/50 border border-green-100' : 'bg-orange-50/50 border border-orange-100'}`}>
                    <div className="shrink-0 mt-0.5">
                      <Sparkles size={20} className={item.isCorrect ? 'text-green-500' : 'text-orange-500'} />
                    </div>
                    <div>
                      <span className={`text-sm font-black block mb-1 ${item.isCorrect ? 'text-green-600' : 'text-orange-600'}`}>AI 선생님의 한마디</span>
                      <p className={`font-bold leading-relaxed ${item.isCorrect ? 'text-green-900' : 'text-orange-900'}`}>{safeText(item.feedback)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )})}
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-4 pb-12">
            {!hasSubmittedQuestion ? (
              <>
                <button onClick={() => setStage('create_question')} className="py-5 px-10 rounded-2xl font-black text-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl transition-all flex items-center justify-center gap-2">
                  <Lightbulb size={24} /> 이제 독서 질문을 만들러 갑시다! ✨
                </button>
                <button onClick={resetQuiz} className="py-5 px-10 rounded-2xl font-bold text-lg bg-slate-200 hover:bg-slate-300 text-slate-700 shadow-sm transition-all">
                  홈으로 돌아가기
                </button>
              </>
            ) : (
              <button onClick={resetQuiz} className="py-5 px-14 rounded-2xl font-black text-lg bg-slate-800 hover:bg-slate-900 text-white shadow-xl transition-all">
                다른 퀴즈도 풀어볼래요!
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function StudentLevelCard({ records, questions }) {
  const levelNum = calcLevel(records, questions);
  if (levelNum === null) return null;
  const level = LEVELS[levelNum - 1];

  return (
    <div className={`rounded-3xl p-6 border-2 ${level.bg} ${level.border} mb-6 shadow-sm`}>
      <div className="flex items-center gap-4 mb-4">
        <div className="text-5xl">{level.emoji}</div>
        <div>
          <p className="text-xs font-black text-slate-400 mb-0.5">나의 현재 문해력 단계</p>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-black ${level.color}`}>{level.level}단계</span>
            <span className={`text-xl font-black ${level.color}`}>{level.name}</span>
          </div>
          <p className={`text-sm font-medium mt-1 ${level.color}`}>{level.desc}</p>
        </div>
      </div>

      {/* 단계 진행 바 */}
      <div className="flex gap-1.5 mb-4">
        {LEVELS.map((l) => (
          <div
            key={l.level}
            className={`flex-1 h-2 rounded-full transition-all ${
              l.level <= levelNum ? level.bg.replace('bg-', 'bg-').replace('-50', '-400') : 'bg-slate-200'
            }`}
            style={{
              backgroundColor: l.level <= levelNum
                ? level.color.replace('text-', '').replace('-600', '') === 'amber'
                  ? '#f59e0b'
                  : l.level <= levelNum ? undefined : undefined
                : undefined
            }}
          />
        ))}
      </div>

      {/* 다음 단계 안내 */}
      {levelNum < 5 && (
        <div className="bg-white/70 rounded-2xl p-4 border border-white/50">
          <p className="text-xs font-black text-slate-500 mb-1">
            ✨ {level.level + 1}단계 <span className={level.color}>{LEVELS[levelNum].name}</span>로 올라가려면?
          </p>
          <p className={`text-sm font-bold ${level.color}`}>{level.next}</p>
        </div>
      )}
      {levelNum === 5 && (
        <div className="bg-white/70 rounded-2xl p-4 border border-white/50">
          <p className="text-sm font-bold text-amber-600">🎉 {level.next}</p>
        </div>
      )}
    </div>
  );
}

function GradingScreen() { 
  const messages = [
    { emoji: '📖', text: 'AI 선생님이 여러분의 답변을 꼼꼼히 읽고 있어요...' },
    { emoji: '🔍', text: '돋보기를 들고 단서를 찾는 중이에요...' },
    { emoji: '🧠', text: '탐정처럼 숨은 의미를 파악하고 있어요...' },
    { emoji: '💬', text: '여러분의 생각을 거울에 비춰보는 중이에요...' },
    { emoji: '✏️', text: '한 문제 한 문제 정성껏 채점하고 있어요...' },
    { emoji: '✨', text: '거의 다 됐어요! 조금만 기다려주세요...' },
  ];

  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex(prev => (prev + 1) % messages.length);
        setFade(true);
      }, 400);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-sky-50 flex flex-col items-center justify-center p-4 text-center">
      <div className="bg-white p-10 rounded-3xl shadow-lg border border-sky-100 max-w-sm w-full">
        <div
          className="text-6xl mb-6 transition-all duration-400"
          style={{ opacity: fade ? 1 : 0, transform: fade ? 'scale(1)' : 'scale(0.8)' }}
        >
          {messages[index].emoji}
        </div>
        <Loader2 size={36} className="text-blue-400 animate-spin mx-auto mb-6" />
        <h2 className="text-2xl font-black text-slate-800 mb-3">채점하는 중...</h2>
        <p
          className="text-slate-500 font-medium transition-all duration-400"
          style={{ opacity: fade ? 1 : 0 }}
        >
          {messages[index].text}
        </p>
        <div className="flex justify-center gap-1.5 mt-6">
          {messages.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-blue-400' : 'w-1.5 bg-slate-200'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
// ==============================================================================
// 보조 컴포넌트: 로그인 에러 스크린
// ==============================================================================

function ErrorScreen({ title, msg, Icon, color }) {
  const colorClass = color === 'orange' ? 'bg-orange-100 text-orange-600 border-orange-500' : 'bg-rose-100 text-rose-600 border-rose-500';
  const textClass = color === 'orange' ? 'text-orange-600' : 'text-rose-600';
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-800">
      <div className={`bg-white p-8 md:p-10 rounded-3xl shadow-xl w-full max-w-2xl border-t-8 ${color === 'orange' ? 'border-orange-500' : 'border-rose-500'}`}>
        <div className="flex items-center gap-4 mb-6">
          <div className={`p-4 rounded-full ${colorClass.split(' ')[0]} ${colorClass.split(' ')[1]}`}><Icon size={32} /></div>
          <div>
            <h1 className={`text-2xl font-black ${textClass}`}>{title}</h1>
            <p className="text-slate-500 font-bold mt-1">{msg}</p>
          </div>
        </div>
        <div className="mt-8 flex justify-center">
          <button onClick={() => window.location.reload()} className="bg-slate-800 hover:bg-slate-900 text-white font-black py-4 px-10 rounded-2xl shadow-lg transition-all">다시 시도하기</button>
        </div>
      </div>
    </div>
  );
}

// ==============================================================================
// 학생: 홈 화면 오늘의 AI 맞춤 조언 컴포넌트 (자동 실행 & 톤 앤 매너 조절)
// ==============================================================================
function StudentDailyAdvice({ myRecords, myQuestions, userName, }) {
  const [advice, setAdvice] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (!hasFetched && userName) {
      getAdvice();
      setHasFetched(true);
    }
  }, [userName, hasFetched]);

  const getAdvice = async () => {
    setIsLoading(true);
    try {
      const recordsText = myRecords.map(r => `[퀴즈] ${r.book} ${r.chapter}: ${r.score}/${r.total}점`).join(', ');
      const qsText = myQuestions.map(q => `[질문출제] ${q.book} ${q.type}유형`).join(', ');
      const levelNum = calcLevel(myRecords, myQuestions);
      const levelInfo = levelNum ? LEVELS[levelNum - 1] : null;

      const promptText = `
      당신은 초등학생의 다정한 독서 코치입니다. 학생 이름은 ${userName}입니다.
      학생의 퀴즈 풀이 기록: ${recordsText || '아직 없음'}
      학생이 출제한 질문 기록: ${qsText || '아직 없음'}
      
      이 기록을 바탕으로 다음 내용을 포함하여 조언해주세요.
      1. 지금까지의 학습 결과나 태도에 대한 담백한 칭찬
      2. 오늘 학습은 어떻게 해볼지 (어떤 부분에서 노력이 필요한지, 어디에 신경 쓸지 구체적인 제안)
      
      [매우 중요한 지시사항]
      - "우와!", "대단해요!" 같은 과장된 칭찬이나 오버하는 표현은 절대 쓰지 마세요. 다정하지만 담백하고 짧게 2~3문장으로 작성하세요.
      - 작성된 피드백의 첫 문장은 문단의 시작이므로, 반드시 공백 4칸(들여쓰기)으로 시작되게 작성하세요. (예: "    오늘도 독서 퀴즈에...")
      `;

      const response = await fetch(`/.netlify/functions/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });
      const data = await response.json();
      setAdvice(data.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (err) {
      console.error(err);
      setAdvice("    앗, 조언을 가져오는 데 실패했어요. 인터넷 연결을 확인하고 다시 접속해 주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!advice && !isLoading) return null;

  return (
    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-3xl shadow-md mb-8 text-white animate-in slide-in-from-top-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-black text-xl flex items-center gap-2">
          <Brain size={24} className="text-indigo-200" /> 오늘의 AI 맞춤 코칭
        </h3>
      </div>
      
      {isLoading ? (
        <div className="flex items-center gap-2 mt-4 text-indigo-100 font-bold">
          <Loader2 size={18} className="animate-spin" /> {userName} 대원의 활동을 분석하고 있어요...
        </div>
      ) : (
        <div className="mt-4 bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/20 font-bold leading-relaxed text-indigo-50 shadow-inner whitespace-pre-wrap">
          {advice}
        </div>
      )}
    </div>
  );
}


// ==============================================================================
// 학생: 스스로 질문 만들기 탭 (폼 & 결과 피드백 & 재제출 기능 통합)
// ==============================================================================
function StudentCreateQuestionTab({ book, chapter, userName, db, appId, teacherQuestions, onClose, showAlert }) {
  const [view, setView] = useState('form'); // 'form' | 'result'
  
  const [qType, setQType] = useState('돋보기');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState('');

  const handleSubmit = async () => {
    if (!question.trim() || !answer.trim()) {
      showAlert('확인해주세요', '질문과 내 생각(정답)을 모두 적어주세요!');
      return;
    }
    setIsSubmitting(true);
    try {
      const teacherQsText = teacherQuestions && teacherQuestions.length > 0 
        ? teacherQuestions.map((q, i) => `${i+1}. ${q.q}`).join('\n') 
        : '없음';

      const promptText = `
      당신은 초등학생이 만든 독서 퀴즈의 '표현과 논리'를 지도하는 예리하고 다정한 국어 선생님입니다.
      AI인 당신은 책의 실제 내용을 모르므로, 질문의 사실 여부(책 내용과 일치하는가)는 절대 평가하지 마세요. 오직 학생이 작성한 단어, 표현, 질문의 논리적 구조만 평가합니다.

      [선생님이 이미 출제한 공식 퀴즈 목록]
      ${teacherQsText}

      [학생 제출 데이터]
      유형: ${qType}
      질문: ${question}
      정답: ${answer}
      
      [매우 중요한 지시사항]
      1. 표절 검사: 학생의 질문이 위 '공식 퀴즈 목록'에 있는 질문과 내용 및 의도가 거의 같다면 "isPlagiarized": true 로 설정하고, feedback에 "앗! 이 질문은 선생님이 이미 내신 퀴즈와 비슷해요. 대원님만의 새로운 질문을 만들어볼까요?"라고만 작성하세요.
      2. 표절이 아닐 경우 피드백 작성 규칙 (isPlagiarized: false):
         - "우와!", "대단해요" 같은 감탄사나 과장된 칭찬을 절대로 쓰지 마세요. 객관적이고 담백한 다정한 말투(해요체)를 유지하세요.
         - 어휘 교정: 학생이 모호한 표현(예: 좋았다, 나빴다, 그랬다)이나 어색한 단어를 썼다면, 문맥을 유추하여 구체적이고 알맞은 단어로 고쳐서 제안해주세요.
         - 보충 요구: 탐정(추론)이나 거울(적용) 질문인데 정답에 인물의 감정이나 말, 행동만 달랑 적었다면 반드시 "그렇게 생각한 이유도 정답에 보충해 볼까요?"라고 피드백에 포함하세요.
         - 전체 피드백의 가장 첫 시작은 반드시 공백 4칸(들여쓰기)으로 시작하세요.
      
      반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 출력하세요.
      {
        "isPlagiarized": boolean,
        "feedback": "피드백 내용"
      }
      `;

      let aiResponseObj = null;
      try {
        const response = await fetch(`/.netlify/functions/gemini`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText }),
        });
        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        aiResponseObj = JSON.parse(cleanJson);
      } catch (e) { console.error('AI 평가 에러:', e); }

      // 표절일 경우 제출 반려 (DB 저장 안 함)
      if (aiResponseObj && aiResponseObj.isPlagiarized) {
        showAlert('제출 불가 🚫', aiResponseObj.feedback);
        setIsSubmitting(false);
        return; 
      }

      const currentFeedback = aiResponseObj ? aiResponseObj.feedback : '    선생님께 질문이 성공적으로 제출되었습니다!';

      // DB 저장
      const qRef = collection(db, 'artifacts', appId, 'public', 'data', 'student_questions');
      await addDoc(qRef, {
        studentName: userName,
        book,
        chapter,
        type: qType,
        question,
        expectedAnswer: answer,
        aiFeedback: currentFeedback, 
        timestamp: Date.now(),
        status: 'pending',
        isReadByStudent: true 
      });
      
      setAiFeedback(currentFeedback);
      setView('result'); // 뷰 전환

    } catch (err) {
      console.error(err);
      showAlert('오류', '제출에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (view === 'form') {
    return (
      <div className="min-h-screen bg-sky-50/50 p-4 md:p-8 font-sans text-slate-800 pb-20">
        <div className="max-w-2xl mx-auto bg-white p-6 md:p-10 rounded-3xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-black flex items-center gap-2"><Lightbulb className="text-yellow-500" size={28}/> 내가 퀴즈 내기</h2>
            <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={20}/></button>
          </div>
          
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 mb-8 flex items-center gap-2 font-black text-slate-600">
            <BookOpen className="text-sky-500" size={20}/> {book} &gt; {chapter}
          </div>

          <div className="space-y-8">
            <div>
              <label className="block font-black text-lg mb-4">1. 어떤 종류의 질문인가요?</label>
              <div className="grid sm:grid-cols-3 gap-3">
                {Object.entries(QUESTION_TYPES).map(([key, meta]) => (
                  <button
                    key={key} onClick={() => setQType(key)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      qType === key ? `${meta.bg} ${meta.border} shadow-sm ring-2 ring-${meta.color.split('-')[1]}-200` : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className={`flex items-center gap-2 font-black mb-1 ${qType === key ? meta.color : 'text-slate-600'}`}>
                      {meta.icon} {key}
                    </div>
                    <div className="text-xs font-medium text-slate-500 break-keep">{meta.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-black text-lg mb-2">2. 친구들에게 물어볼 질문은?</label>
              <textarea
                value={question} onChange={e => setQuestion(e.target.value)}
                placeholder="여기에 질문을 적어주세요..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-indigo-400 outline-none resize-y min-h-[100px] font-medium transition-colors"
              />
            </div>

            <div>
              <label className="block font-black text-lg mb-2">3. 내가 생각하는 정답은?</label>
              <textarea
                value={answer} onChange={e => setAnswer(e.target.value)}
                placeholder="AI 선생님이 평가할 때 참고할 모범 정답을 적어주세요."
                className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-indigo-400 outline-none resize-y min-h-[100px] font-medium transition-colors"
              />
            </div>

            <button
              onClick={handleSubmit} disabled={isSubmitting}
              className="w-full py-4 rounded-2xl font-black text-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg flex justify-center items-center gap-2 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? <Loader2 className="animate-spin"/> : <><Sparkles size={20}/> 선생님께 제출하기</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 결과 & 재제출 뷰 (챗봇형 피드백 + 에디터)
  if (view === 'result') {
    const typeMeta = QUESTION_TYPES[qType] || QUESTION_TYPES['돋보기'];
    return (
      <div className="min-h-screen bg-sky-50/50 p-4 md:p-8 font-sans text-slate-800 pb-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200 animate-in slide-in-from-bottom-4">
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black flex items-center gap-2"><Lightbulb className="text-yellow-500" size={24}/> 질문 제출 완료!</h2>
              <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={20}/></button>
            </div>

            {/* 내가 제출한 내용 요약 */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 mb-6">
              <div className="flex gap-2 mb-3">
                <span className={`text-xs px-2 py-1 rounded-full font-black flex items-center gap-1 ${typeMeta.bg} ${typeMeta.color}`}>
                  {typeMeta.icon} {qType} 질문
                </span>
              </div>
              <div className="mb-3">
                <span className="text-[10px] font-black text-slate-400 block mb-1">내가 낸 질문</span>
                <p className="font-bold text-slate-800">{question}</p>
              </div>
              <div>
                <span className="text-[10px] font-black text-slate-400 block mb-1">내가 생각한 정답</span>
                <p className="font-medium text-slate-600">{answer}</p>
              </div>
            </div>

            {/* AI 피드백 박스 */}
            <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100 mb-8 relative">
              <div className="absolute -top-3 -left-3 bg-purple-500 p-2 rounded-full border-4 border-white"><MessageCircle size={16} className="text-white"/></div>
              <h4 className="text-sm font-black text-purple-700 mb-2 ml-3">AI 선생님의 피드백</h4>
              <p className="text-[15px] font-bold text-purple-900 leading-relaxed whitespace-pre-wrap">{aiFeedback}</p>
            </div>

            {/* 즉시 수정 폼 */}
            <div className="bg-white p-6 rounded-2xl border-2 border-indigo-50">
              <h4 className="font-black text-slate-700 mb-4 flex items-center gap-2"><Edit3 className="text-indigo-500" size={18}/> 피드백을 반영하여 다시 써볼까요?</h4>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="sm:w-32 shrink-0">
                  <select 
                    value={qType} onChange={e=>setQType(e.target.value)}
                    className={`w-full p-3 text-sm font-black rounded-xl border-2 outline-none appearance-none cursor-pointer text-center ${QUESTION_TYPES[qType]?.bg} ${QUESTION_TYPES[qType]?.color} ${QUESTION_TYPES[qType]?.border}`}
                  >
                    <option value="돋보기">🔍 돋보기</option>
                    <option value="탐정">🧠 탐정</option>
                    <option value="거울">💬 거울</option>
                  </select>
                </div>
                <div className="flex-1 space-y-3">
                  <textarea 
                    value={question} onChange={e=>setQuestion(e.target.value)} 
                    className="w-full p-3 border-2 border-slate-200 rounded-xl focus:border-indigo-400 outline-none resize-y min-h-[60px] font-bold text-sm" 
                    placeholder="질문을 수정해보세요." 
                  />
                  <textarea 
                    value={answer} onChange={e=>setAnswer(e.target.value)} 
                    className="w-full p-3 border-2 border-slate-200 rounded-xl focus:border-indigo-400 outline-none resize-y min-h-[60px] font-medium text-sm text-slate-600" 
                    placeholder="정답을 수정해보세요." 
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">홈으로 돌아가기</button>
                <button onClick={handleSubmit} disabled={isSubmitting} className="px-6 py-3 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-md flex items-center gap-2 transition-colors disabled:opacity-50">
                  {isSubmitting ? <Loader2 size={18} className="animate-spin"/> : <Sparkles size={18}/>} 다시 제출하기
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  }
}

// ==============================================================================
// 선생님: 학생 진단 (기록 탭)
// ==============================================================================
function TeacherRecordsTab({ allRecords, studentQuestions, db, appId }) {
  const studentsMap = {};
  
  allRecords.forEach((record) => {
    if (!studentsMap[record.studentName]) studentsMap[record.studentName] = { name: record.studentName, logs: [], myQuestions: [] };
    studentsMap[record.studentName].logs.push(record);
  });
  
  studentQuestions.forEach((q) => {
    if (!studentsMap[q.studentName]) studentsMap[q.studentName] = { name: q.studentName, logs: [], myQuestions: [] };
    studentsMap[q.studentName].myQuestions.push(q);
  });

  const groupedStudents = Object.values(studentsMap);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden p-6">
      <div className="mb-6 flex items-center gap-2 text-indigo-800 bg-indigo-50 p-4 rounded-xl">
        <Brain className="text-indigo-500" />
        <div>
          <span className="font-bold block">학생 문해력 파악하기 (5차원 AI 자동 진단)</span>
          <span className="text-sm">학생 카드 클릭 시 퀴즈 답변과 출제/수정 질문을 종합하여 자동으로 진단 결과를 출력합니다.</span>
        </div>
      </div>

      {groupedStudents.length === 0 ? (
        <div className="py-12 text-center text-slate-400 font-medium">아직 제출된 기록이 없습니다.</div>
      ) : (
        <div className="space-y-4">
          {groupedStudents.map((student, i) => (
            <TeacherStudentCard key={i} student={student} db={db} appId={appId} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherStudentCard({ student, db, appId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const sortedLogs = [...student.logs].sort((a, b) => b.timestamp - a.timestamp);
  const handleDeleteLog = async (logId) => {
    if (!window.confirm('이 퀴즈 기록을 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reading_quiz_logs', logId));
    } catch (err) {
      console.error(err);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };
  const myQs = [...student.myQuestions].sort((a, b) => b.timestamp - a.timestamp);

  // 아코디언 오픈 시 자동 분석 실행
  useEffect(() => {
    if (isOpen && !aiAnalysis && !isAnalyzing) {
      generateAnalysis();
    }
  }, [isOpen]);

  const generateAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const answersText = sortedLogs.map((log) => {
        return `[${log.book} - ${log.chapter} 퀴즈 풀이]\n` + log.details.map((d) => `Q(${d.questionType}): ${safeText(d.questionText)}\n답변: ${safeText(d.userAnswer)}`).join('\n\n');
      }).join('\n\n---\n\n');

      const myQsText = myQs.length > 0 
        ? `\n\n[학생이 직접 출제/수정한 질문 기록]\n` + myQs.map(q => `제출일시: ${formatDateTime(q.timestamp)}\n유형: ${q.type}\n질문: ${q.question}\n기대답안: ${q.expectedAnswer}\n교사코멘트: ${q.teacherComment || '없음'}`).join('\n\n')
        : `\n\n[학생이 직접 출제한 질문]: 없음`;

      const promptText = `
      당신은 초등학교 학생들의 독서 문해력을 정밀하게 진단하는 교육 전문가 AI입니다.
      다음은 한 학생이 책을 읽고 '선생님의 퀴즈에 답한 내용'과 '자신이 여러 번 출제/수정한 질문' 기록입니다.

      [매우 중요한 지시사항]
      1. 학생이 피드백을 받고 같은 챕터에 여러 번 질문을 수정한 기록이 있다면, 문해력과 표현력이 어떻게 발전했는지 그 성장 과정을 긍정적으로 분석에 반영하세요.
      2. 교사의 사후 피드백(teacherComment)이 존재한다면, 해당 피드백을 학생이 잘 수용했는지도 평가하세요.

      위 내용을 바탕으로 아래 5가지 영역을 1~5점 척도로 평가하고, 짧고 담백한 피드백을 제공하세요.
      1. 표면적 이해도 (세부 정보 파악)
      2. 숨은 의미 이해 (추론 능력)
      3. 내면화 정도 (자신의 삶과 연결)
      4. 읽기의 능동성 (스스로 질문을 생성/수정하는 수준)
      5. 문해력 및 표현력 (어휘의 풍부함과 문장의 구체성)

      반드시 아래 JSON 형식으로만 응답하세요. (마크다운 없이 순수 JSON)
      {
        "scores": { "surface": 3, "inference": 4, "internalization": 2, "activeness": 5, "expression": 3 },
        "feedbacks": { "surface": "피드백...", "inference": "피드백...", "internalization": "피드백...", "activeness": "피드백...", "expression": "피드백..." },
        "summary": "종합 평가 2문장"
      }

      [학생 기록 시작]
      ${answersText}
      ${myQsText}
      `;

      const response = await fetch(`/.netlify/functions/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });

      const data = await response.json();
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (resultText) {
        const cleanText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        setAiAnalysis(JSON.parse(cleanText));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const DimensionBar = ({ label, score, feedback, colorClass }) => (
    <div className="mb-4">
      <div className="flex justify-between items-end mb-1">
        <span className="font-bold text-slate-700 text-sm">{label}</span>
        <span className={`font-black text-lg ${colorClass}`}>{score}<span className="text-xs text-slate-400">/5</span></span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden flex">
        <div className={`h-2.5 rounded-full ${colorClass.replace('text-', 'bg-')}`} style={{ width: `${(score / 5) * 100}%`, transition: 'width 1s ease-in-out' }}></div>
      </div>
      <p className="text-xs text-slate-500 font-medium leading-relaxed bg-slate-50 p-2 rounded-lg">{feedback}</p>
    </div>
  );

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm transition-all hover:border-indigo-200">
      <div className="w-full flex items-center justify-between p-5 bg-slate-50/50 hover:bg-slate-50 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <div className="flex items-center gap-4 flex-1">
          <div className="bg-blue-100 p-3 rounded-full text-blue-600">
            <User size={20} />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-lg text-slate-800">{safeText(student.name)} 학생</h3>
            <div className="flex gap-2 mt-0.5">
              <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded border border-slate-200">푼 퀴즈 {student.logs.length}건</span>
              <span className="text-xs text-purple-600 font-medium bg-purple-100 px-2 py-0.5 rounded border border-purple-200">제출한 질문 {student.myQuestions.length}건</span>
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          {isAnalyzing && <div className="text-indigo-400 text-sm font-bold flex items-center gap-1"><Loader2 size={16} className="animate-spin" /> 자동 분석 중...</div>}
          <div className="text-slate-400 p-2">{isOpen ? <ChevronUp size={24} /> : <ChevronDown size={24} />}</div>
        </div>
      </div>

      {isOpen && (
        <div className="p-5 border-t border-slate-200 bg-white animate-in slide-in-from-top-2">
          {aiAnalysis && (
            <div className="mb-6 bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 p-5 rounded-2xl relative">
              <div className="absolute top-4 right-4 text-indigo-200"><Brain size={32} /></div>
              <h4 className="font-bold text-indigo-800 flex items-center gap-2 mb-4"><Sparkles size={18} /> AI 맞춤형 5차원 진단 리포트</h4>
              <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
                <div>
                  <DimensionBar label="① 표면적 이해도 (돋보기)" score={aiAnalysis.scores.surface} feedback={aiAnalysis.feedbacks.surface} colorClass="text-blue-500"/>
                  <DimensionBar label="② 숨은 의미 이해 (탐정)" score={aiAnalysis.scores.inference} feedback={aiAnalysis.feedbacks.inference} colorClass="text-purple-500"/>
                  <DimensionBar label="③ 내면화 정도 (거울)" score={aiAnalysis.scores.internalization} feedback={aiAnalysis.feedbacks.internalization} colorClass="text-rose-500"/>
                </div>
                <div>
                  <DimensionBar label="④ 읽기의 능동성 (질문 생성/수정)" score={aiAnalysis.scores.activeness} feedback={aiAnalysis.feedbacks.activeness} colorClass="text-amber-500"/>
                  <DimensionBar label="⑤ 문해력 및 표현력" score={aiAnalysis.scores.expression} feedback={aiAnalysis.feedbacks.expression} colorClass="text-emerald-500"/>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-indigo-100">
                <span className="text-xs font-black text-indigo-400 mb-1 block">종합 코멘트</span>
                <p className="text-indigo-900 leading-relaxed font-medium whitespace-pre-wrap">{aiAnalysis.summary}</p>
              </div>
            </div>
          )}

          <div className="grid xl:grid-cols-2 gap-6 mt-6">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 h-fit">
              <h4 className="font-black text-slate-700 pb-3 mb-4 flex items-center gap-2 border-b-2 border-slate-200">
                <CheckCircle2 className="text-blue-500" size={20}/> 푼 퀴즈 기록
                <span className="text-xs font-bold text-slate-400 ml-auto">{sortedLogs.length}건</span>
              </h4>
              {sortedLogs.length === 0 && <p className="text-sm text-slate-400 text-center py-4">기록이 없습니다.</p>}
              <div className="space-y-4">
                {sortedLogs.map((log) => (
                  <div key={log.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-3 border-b border-slate-50 pb-2">
                      <div>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-bold mr-2">{safeText(log.book)}</span>
                        <span className="text-slate-700 font-bold text-sm">{safeText(log.chapter)}</span>
                      </div>
                      {/* 정밀한 날짜 및 시간 표기 */}
                      <div className="text-[10px] text-slate-400 font-bold">{formatDateTime(log.timestamp)}</div>
                    </div>
                    <div className="space-y-2">
                      {log.details.map((detail, dIdx) => (
                        <div key={dIdx} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="flex gap-1 mb-1">
                             <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${QUESTION_TYPES[detail.questionType]?.color}`}>{detail.questionType}</span>
                          </div>
                          <p className="font-bold text-slate-700 mb-2 text-xs">Q. {safeText(detail.questionText)}</p>
                          <div className="pl-2 border-l-2 border-slate-300">
                            <p className="text-slate-600 font-medium text-xs">{safeText(detail.userAnswer)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-purple-50/50 p-4 rounded-2xl border border-purple-100 h-fit">
              <h4 className="font-black text-purple-800 pb-3 mb-4 flex items-center gap-2 border-b-2 border-purple-200">
                <Lightbulb className="text-purple-500" size={20}/> 출제한 질문 기록
                <span className="text-xs font-bold text-purple-400 ml-auto">{myQs.length}건</span>
              </h4>
              {myQs.length === 0 && <p className="text-sm text-purple-300 text-center py-4">기록이 없습니다.</p>}
              <div className="space-y-4">
                {myQs.map(q => (
                  <div key={q.id} className="bg-white border border-purple-100 rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-bold mr-2">{q.book} &gt; {q.chapter}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${QUESTION_TYPES[q.type]?.bg} ${QUESTION_TYPES[q.type]?.color}`}>{q.type}</span>
                      </div>
                      <div className="text-right">
                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded mb-1 inline-block ${q.status === 'approved' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                          {q.status === 'approved' ? '채택됨' : '대기/반려'}
                        </div>
                        {/* 정밀한 날짜 및 시간 표기 */}
                        <div className="text-[10px] text-slate-400 font-bold block">{formatDateTime(q.timestamp)}</div>
                      </div>
                    </div>
                    <div className="mb-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <span className="text-[10px] font-black text-slate-400 block mb-1">학생 질문</span>
                      <p className="text-sm font-bold text-slate-800">{q.question}</p>
                    </div>
                    {q.aiFeedback && (
                      <div className="pt-2 border-t border-purple-50">
                        <span className="text-[10px] font-black text-purple-400 block mb-1 flex items-center gap-1"><MessageCircle size={10}/> AI 피드백</span>
                        <p className="text-xs font-bold text-purple-800 leading-relaxed bg-purple-50/50 p-2 rounded whitespace-pre-wrap">{q.aiFeedback}</p>
                      </div>
                    )}
                    {q.teacherComment && (
                      <div className="mt-3 pt-2 border-t border-indigo-100">
                        <span className="text-[10px] font-black text-indigo-500 block mb-1 flex items-center gap-1"><User size={10}/> 선생님 코멘트</span>
                        <p className="text-xs font-bold text-indigo-900 leading-relaxed bg-indigo-50 p-2 rounded whitespace-pre-wrap">{q.teacherComment}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==============================================================================
// 선생님: 학생 질문 채택 탭 (사후 피드백 기능 추가)
// ==============================================================================
function TeacherApproveTab({ studentQuestions, quizDataState, db, appId, showAlert, showConfirm }) {
  const pendingQs = studentQuestions.filter(q => q.status === 'pending');
  const [comments, setComments] = useState({});

  const handleApprove = (qDoc) => {
    // 안전장치: quizDataState가 비어있으면 채택 거부
    if (!quizDataState || Object.keys(quizDataState).length === 0) {
      showAlert('채택 불가', 'Firebase 데이터가 아직 로드되지 않았습니다.\n페이지를 새로고침 후 다시 시도해주세요.');
      return;
    }
    showConfirm('질문 채택', `'${qDoc.studentName}' 학생의 질문을 공식 퀴즈로 등록할까요?`, async () => {
      try {
        const newData = JSON.parse(JSON.stringify(quizDataState));
        if (!newData[qDoc.book]) newData[qDoc.book] = {};
        if (!newData[qDoc.book][qDoc.chapter]) {
          newData[qDoc.book][qDoc.chapter] = {
            questions: [],
            settings: { quota: { '돋보기': 5, '탐정': 3, '거울': 2 }, total: 10 },
            synopsis: ''
          };
        }

        // 새 구조(questions 배열) vs 구 구조(배열) 모두 호환
        if (Array.isArray(newData[qDoc.book][qDoc.chapter])) {
          newData[qDoc.book][qDoc.chapter].push({
            type: qDoc.type, q: qDoc.question, a: qDoc.expectedAnswer, createdBy: qDoc.studentName
          });
        } else {
          newData[qDoc.book][qDoc.chapter].questions.push({
            type: qDoc.type, q: qDoc.question, a: qDoc.expectedAnswer, createdBy: qDoc.studentName
          });
        }

        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quiz_config', 'main_data'), { quizData: newData });
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_questions', qDoc.id), { 
          status: 'approved',
          teacherComment: comments[qDoc.id] || '',
          isReadByStudent: false 
        });

        showAlert('성공', '공식 퀴즈로 등록되었습니다!');
      } catch (err) {
        console.error(err);
      }
    });
  };

  const handleReject = (qDoc) => {
    showConfirm('반려/피드백', '이 질문을 대기열에서 제외하고 학생에게 피드백을 전달할까요?', async () => {
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_questions', qDoc.id), { 
          status: 'rejected',
          teacherComment: comments[qDoc.id] || '',
          isReadByStudent: false 
        });
      } catch (err) {
        console.error(err);
      }
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="mb-6 flex items-start gap-3 text-rose-800 bg-rose-50 p-5 rounded-2xl border border-rose-100">
        <Lightbulb className="text-rose-500 mt-1 shrink-0" size={28}/>
        <div>
          <span className="font-black text-lg block mb-1">학생 출제 질문 검토 및 사후 피드백</span>
          <p className="text-sm font-medium leading-relaxed">
            학생의 질문을 확인하고 <strong>코멘트를 남긴 뒤 채택 또는 반려</strong>할 수 있습니다. 남긴 코멘트는 학생이 접속했을 때 알림으로 전달됩니다.
          </p>
        </div>
      </div>

      {pendingQs.length === 0 ? (
        <div className="py-12 text-center text-slate-400 font-medium border-2 border-dashed border-slate-100 rounded-2xl">대기 중인 질문이 없습니다.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {pendingQs.map(q => {
             const typeMeta = QUESTION_TYPES[q.type] || QUESTION_TYPES['돋보기'];
             return (
              <div key={q.id} className="border-2 border-slate-100 rounded-2xl p-5 bg-white shadow-sm flex flex-col">
                <div className="flex justify-between items-start mb-4 border-b border-slate-50 pb-3">
                  <div>
                    <span className="text-xs font-black bg-slate-100 text-slate-600 px-2 py-1 rounded mr-2">{q.book} &gt; {q.chapter}</span>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-black ${typeMeta.bg} ${typeMeta.color}`}>{q.type}</span>
                  </div>
                  <div className="text-right">
                     <div className="font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded text-sm mb-1"><User size={14} className="inline mr-1 -mt-0.5"/>{q.studentName}</div>
                     <span className="text-[10px] font-bold text-slate-400">{formatDateTime(q.timestamp)}</span>
                  </div>
                </div>
                
                <div className="flex-1 space-y-3 mb-4">
                  <div>
                    <span className="text-[10px] font-black text-slate-400 block mb-1">학생 질문</span>
                    <p className="font-bold text-slate-800 text-sm whitespace-pre-wrap">{q.question}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 block mb-1">학생 정답</span>
                    <p className="font-bold text-slate-600 text-sm whitespace-pre-wrap">{q.expectedAnswer}</p>
                  </div>
                  <textarea
                    value={comments[q.id] || ''}
                    onChange={e => setComments({...comments, [q.id]: e.target.value})}
                    placeholder="학생에게 전달할 사후 피드백을 입력하세요 (선택)"
                    className="w-full p-3 text-sm font-medium border border-indigo-200 rounded-xl bg-indigo-50/30 focus:bg-white focus:border-indigo-400 outline-none resize-y min-h-[60px]"
                  />
                </div>

                <div className="flex gap-2 mt-auto">
                  <button onClick={() => handleApprove(q)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-black text-sm flex justify-center items-center gap-1 transition-colors">
                    <Check size={16}/> 채택
                  </button>
                  <button onClick={() => handleReject(q)} className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-xl font-bold text-sm transition-colors">
                    반려/피드백
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  );
}

// ==============================================================================
// 선생님: 메인 퀴즈 관리 탭 (안전한 원본 로직 유지)
// ==============================================================================
function TeacherManageTab({ quizDataState, db, appId, showConfirm, showAlert, }) {
  const [editingData, setEditingData] = useState(() => {
    // 구 구조(배열)를 새 구조로 자동 변환
    const converted = {};
    Object.entries(quizDataState || {}).forEach(([book, chapters]) => {
      converted[book] = {};
      Object.entries(chapters).forEach(([chapter, data]) => {
        if (Array.isArray(data)) {
          converted[book][chapter] = {
            questions: data,
            settings: { quota: { '돋보기': 5, '탐정': 3, '거울': 2 }, total: 10 }
          };
        } else {
          converted[book][chapter] = data;
        }
      });
    });
    return converted;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [selectedBookForEdit, setSelectedBookForEdit] = useState(null);
  const [newBookName, setNewBookName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [renamingBook, setRenamingBook] = useState(null);
  const [renamingBookInput, setRenamingBookInput] = useState('');
  const [renamingChapter, setRenamingChapter] = useState(null);
  const [renamingChapterInput, setRenamingChapterInput] = useState('');
  const [classifyingIndex, setClassifyingIndex] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState({});
  const toggleChapter = (book, chapter) => {
    const key = `${book}__${chapter}`;
    setExpandedChapters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const sortedChapters = (bookName) =>
    Object.keys(editingData[bookName] || {}).sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] ?? '9999');
      const numB = parseInt(b.match(/\d+/)?.[0] ?? '9999');
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b, 'ko');
    });

  const getQuestions = (book, chapter) =>
    editingData[book]?.[chapter]?.questions || [];

  const getSettings = (book, chapter) =>
    editingData[book]?.[chapter]?.settings || { quota: { '돋보기': 5, '탐정': 3, '거울': 2 }, total: 10 };

  const getSynopsis = (book, chapter) =>
    editingData[book]?.[chapter]?.synopsis || '';

  const handleSynopsisChange = (book, chapter, value) => {
    setEditingData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      newData[book][chapter].synopsis = value;
      return newData;
    });
  };

  // AI 자동 유형 분류
  const autoClassifyQuestion = async (book, chapter, qIndex, questionText) => {
    if (!questionText.trim() || questionText.trim().length < 5) return;
    setClassifyingIndex(`${book}-${chapter}-${qIndex}`);
    try {
      const response = await fetch(
        `/.netlify/functions/gemini`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: `다음 독서 퀴즈 질문의 유형을 판단하세요.

            돋보기: 책에 명시된 사실 확인 (누가, 언제, 어디서, 무엇을)
            탐정: 이유, 원인, 숨은 의미, 인물의 마음 추론 (왜, 어떻게)
            거울: 자신의 경험이나 생각과 연결 (만약 나라면, 내 생각은)

            질문: ${questionText}

            JSON만 출력: {"type": "돋보기" 또는 "탐정" 또는 "거울"}`
          }),
        }
      );
      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(clean);
      if (['돋보기', '탐정', '거울'].includes(result.type)) {
        handleQuestionChange(book, chapter, qIndex, 'type', result.type);
      }
    } catch (e) {
      console.error('자동 분류 실패:', e);
    } finally {
      setClassifyingIndex(null);
    }
  };

  const handleQuestionChange = (book, chapter, qIndex, field, value) => {
    setEditingData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      newData[book][chapter].questions[qIndex][field] = value;
      return newData;
    });
  };

  const handleSettingsChange = (book, chapter, type, value) => {
    setEditingData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      const num = Math.max(0, parseInt(value) || 0);
      newData[book][chapter].settings.quota[type] = num;
      newData[book][chapter].settings.total =
        Object.values(newData[book][chapter].settings.quota).reduce((a, b) => a + b, 0);
      return newData;
    });
  };

  const addQuestion = (book, chapter) => {
    setEditingData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      newData[book][chapter].questions.push({ type: '돋보기', q: '', a: '' });
      return newData;
    });
  };

  const deleteQuestion = (book, chapter, qIndex) => {
    showConfirm('삭제', '이 질문을 삭제하시겠습니까?', () => {
      setEditingData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        newData[book][chapter].questions.splice(qIndex, 1);
        return newData;
      });
    });
  };

  const addNewBook = () => {
    if (!newBookName.trim()) return;
    if (editingData[newBookName]) return showAlert('알림', '이미 있는 책 이름입니다.');
    setEditingData(prev => ({ ...prev, [newBookName]: {} }));
    setNewBookName('');
  };

  const addNewChapter = (bookName) => {
    if (!newChapterName.trim()) return;
    if (editingData[bookName][newChapterName]) return showAlert('알림', '이미 있는 챕터입니다.');
    setEditingData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      newData[bookName][newChapterName] = {
        questions: [{ type: '돋보기', q: '', a: '' }],
        settings: { quota: { '돋보기': 5, '탐정': 3, '거울': 2 }, total: 10 },
        synopsis: ''
      };
      return newData;
    });
    setNewChapterName('');
  };

  const deleteBook = (book) => {
    showConfirm('책 삭제', `'${book}' 책 전체를 삭제하시겠습니까?`, () => {
      setEditingData(prev => { const newData = JSON.parse(JSON.stringify(prev)); delete newData[book]; return newData; });
      setSelectedBookForEdit(null);
    });
  };

  const deleteChapter = (book, chapter) => {
    showConfirm('챕터 삭제', `'${chapter}' 전체를 삭제하시겠습니까?`, () => {
      setEditingData(prev => { const newData = JSON.parse(JSON.stringify(prev)); delete newData[book][chapter]; return newData; });
    });
  };

  const startRenamingBook = (book) => { setRenamingBook(book); setRenamingBookInput(book); };
  const saveRenamingBook = (oldName) => {
    const newName = renamingBookInput.trim();
    if (!newName || newName === oldName) return setRenamingBook(null);
    if (editingData[newName]) return showAlert('오류', '이미 존재하는 책 이름입니다.');
    setEditingData(prev => { const newData = JSON.parse(JSON.stringify(prev)); newData[newName] = newData[oldName]; delete newData[oldName]; return newData; });
    setRenamingBook(null); setSelectedBookForEdit(newName);
  };

  const startRenamingChapter = (book, chapter) => { setRenamingChapter({ book, chapter }); setRenamingChapterInput(chapter); };
  const saveRenamingChapter = (book, oldChapter) => {
    const newChapter = renamingChapterInput.trim();
    if (!newChapter || newChapter === oldChapter) return setRenamingChapter(null);
    if (editingData[book][newChapter]) return showAlert('오류', '이미 존재하는 챕터입니다.');
    setEditingData(prev => { const newData = JSON.parse(JSON.stringify(prev)); newData[book][newChapter] = newData[book][oldChapter]; delete newData[book][oldChapter]; return newData; });
    setRenamingChapter(null);
  };

  const saveToCloud = async () => {
    // 안전장치 1: editingData가 비어있으면 저장 거부
    if (!editingData || Object.keys(editingData).length === 0) {
      showAlert('저장 거부', '저장할 데이터가 없습니다. 페이지를 새로고침 후 다시 시도해주세요.');
      return;
    }
    
    // 안전장치 2: 현재 Firebase 데이터와 비교해서 데이터가 대폭 줄어들면 확인 받기
    const currentBookCount = Object.keys(quizDataState || {}).length;
    const newBookCount = Object.keys(editingData).length;
    if (currentBookCount > 0 && newBookCount < currentBookCount) {
      const confirmed = window.confirm(
        `⚠️ 경고: 현재 ${currentBookCount}권의 책이 저장되어 있는데, ${newBookCount}권만 저장하려고 합니다.\n\n` +
        `정말 저장하시겠습니까? (책이 삭제될 수 있습니다)`
      );
      if (!confirmed) return;
    }

    // 안전장치 3: 전체 문제 수가 절반 이하로 줄어들면 경고
    const countQuestions = (data) => {
      let total = 0;
      Object.values(data || {}).forEach(chapters => {
        Object.values(chapters).forEach(chap => {
          const qs = Array.isArray(chap) ? chap : (chap?.questions || []);
          total += qs.length;
        });
      });
      return total;
    };
    const currentQCount = countQuestions(quizDataState);
    const newQCount = countQuestions(editingData);
    if (currentQCount > 0 && newQCount < currentQCount * 0.5) {
      if (!window.confirm(`⚠️ 경고\n\n현재 ${currentQCount}개의 문제가 저장되어 있는데, ${newQCount}개만 저장하려고 합니다.\n문제가 절반 이상 사라질 수 있습니다.\n\n정말 저장하시겠습니까?`)) {
        return;
      }
    }
    
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quiz_config', 'main_data'), { quizData: editingData });
      showAlert('저장 성공', '성공적으로 저장되었습니다!');
    } catch (err) { 
      showAlert('저장 실패', '오류가 발생했습니다.'); 
    } finally { 
      setIsSaving(false); 
    }
  };

  // 책 목록 화면
  if (!selectedBookForEdit) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold flex items-center gap-2"><BookOpen className="text-blue-500" /> 등록된 책 목록</h2>
          <button onClick={saveToCloud} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors disabled:opacity-50">
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} 저장
          </button>
        </div>
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 mb-6">
          <h3 className="text-sm font-bold text-slate-600 mb-2">새로운 책 추가하기</h3>
          <div className="flex gap-2">
            <input type="text" value={newBookName} onChange={(e) => setNewBookName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNewBook()}
              placeholder="책 제목 입력" className="flex-1 p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" />
            <button onClick={addNewBook} className="bg-slate-800 text-white px-3 py-2 rounded-lg font-bold"><Plus size={18} /></button>
          </div>
        </div>
        <div className="space-y-3">
          {Object.keys(editingData).length === 0 && <p className="text-center text-slate-400 py-10">등록된 책이 없습니다.</p>}
          {Object.keys(editingData).map((bookName) => (
            <button key={bookName} onClick={() => setSelectedBookForEdit(bookName)}
              className="w-full text-left px-5 py-4 rounded-2xl border-2 border-slate-100 hover:border-blue-400 hover:bg-blue-50 flex justify-between items-center transition-all">
              <div className="flex items-center gap-3">
                <BookOpen size={20} className="text-slate-400" />
                <span className="font-bold text-slate-700">{safeText(bookName)}</span>
                <span className="text-sm text-slate-400">({Object.keys(editingData[bookName]).length}개 챕터)</span>
              </div>
              <ChevronRight size={20} className="text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 책 상세 편집 화면
  const bookName = selectedBookForEdit;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      {/* 상단 헤더 */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedBookForEdit(null)}
            className="flex items-center gap-1 text-slate-500 hover:text-slate-800 font-bold bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-xl transition-colors">← 목록</button>
          {renamingBook === bookName ? (
            <div className="flex items-center gap-2">
              <input type="text" value={renamingBookInput} onChange={(e) => setRenamingBookInput(e.target.value)}
                className="p-2 border border-indigo-300 rounded-lg focus:outline-none font-bold" autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveRenamingBook(bookName)} />
              <button onClick={() => saveRenamingBook(bookName)} className="bg-indigo-500 text-white px-3 py-2 rounded-lg font-bold text-sm">저장</button>
              <button onClick={() => setRenamingBook(null)} className="bg-slate-200 text-slate-600 px-3 py-2 rounded-lg font-bold text-sm">취소</button>
            </div>
          ) : (
            <h2 className="text-lg font-bold flex items-center gap-2">
              <BookOpen className="text-blue-500" /> {safeText(bookName)}
              <button onClick={() => startRenamingBook(bookName)} className="text-indigo-400 hover:text-indigo-600 ml-1"><Edit3 size={16} /></button>
            </h2>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => deleteBook(bookName)}
            className="text-red-500 hover:bg-red-50 px-3 py-2 rounded-xl font-bold flex items-center gap-1 text-sm"><Trash2 size={16} /> 책 삭제</button>
          <button onClick={saveToCloud} disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors disabled:opacity-50">
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} 전체 저장
          </button>
        </div>
      </div>

      {/* 챕터 추가 */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6">
        <h3 className="text-sm font-bold text-slate-600 mb-2">새 챕터 추가</h3>
        <div className="flex gap-2">
          <input type="text" value={newChapterName} onChange={(e) => setNewChapterName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNewChapter(bookName)}
            placeholder="챕터 이름 (예: 3장)" className="flex-1 p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" />
          <button onClick={() => addNewChapter(bookName)} className="bg-slate-800 text-white px-3 py-2 rounded-lg font-bold"><Plus size={18} /></button>
        </div>
      </div>

      {/* 챕터 목록 */}
      <div className="space-y-8">
        {sortedChapters(bookName).length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">챕터가 없습니다. 위에서 챕터를 추가해주세요.</p>
        )}
        {sortedChapters(bookName).map((chapterName) => {
          const questions = getQuestions(bookName, chapterName);
          const settings = getSettings(bookName, chapterName);
          const total = settings.total || 10;
          const quota = settings.quota || { '돋보기': 5, '탐정': 3, '거울': 2 };

          // 실제 등록된 유형별 문제 수
          const actualCounts = { '돋보기': 0, '탐정': 0, '거울': 0 };
          questions.forEach(q => { if (actualCounts[q.type || '돋보기'] !== undefined) actualCounts[q.type || '돋보기']++; });

          return (
            <div key={chapterName} className="border border-slate-200 rounded-2xl overflow-hidden">
              {/* 챕터 헤더 */}
              <div className="flex justify-between items-center p-4 bg-slate-50 border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleChapter(bookName, chapterName)}>
                {renamingChapter?.book === bookName && renamingChapter?.chapter === chapterName ? (
                  <div className="flex items-center gap-2">
                    <input type="text" value={renamingChapterInput} onChange={(e) => setRenamingChapterInput(e.target.value)}
                      className="p-1 border border-indigo-300 rounded focus:outline-none font-bold text-indigo-700" autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && saveRenamingChapter(bookName, chapterName)} />
                    <button onClick={() => saveRenamingChapter(bookName, chapterName)} className="bg-indigo-500 text-white px-2 py-1 rounded font-bold text-xs">저장</button>
                    <button onClick={() => setRenamingChapter(null)} className="bg-slate-200 text-slate-600 px-2 py-1 rounded font-bold text-xs">취소</button>
                  </div>
                ) : (
                  <h4 className="font-bold text-lg text-indigo-700">{safeText(chapterName)}</h4>
                )}
                <div className="flex items-center gap-2">
                  {!(renamingChapter?.book === bookName && renamingChapter?.chapter === chapterName) && (
                    <button onClick={(e) => { e.stopPropagation(); startRenamingChapter(bookName, chapterName); }} className="text-indigo-400 hover:text-indigo-600 p-1"><Edit3 size={16} /></button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); deleteChapter(bookName, chapterName); }} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                  <div className="text-slate-400 p-1 pointer-events-none">
                    {expandedChapters[`${bookName}__${chapterName}`] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>
              </div>

              {expandedChapters[`${bookName}__${chapterName}`] && <>
              {/* 챕터 줄거리 */}
              <div className="p-4 bg-amber-50/50 border-b border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen size={16} className="text-amber-500" />
                  <span className="text-sm font-black text-amber-700">챕터 줄거리 (AI 채점 참고용)</span>
                </div>
                <textarea
                  value={getSynopsis(bookName, chapterName)}
                  onChange={(e) => handleSynopsisChange(bookName, chapterName, e.target.value)}
                  placeholder="이 챕터의 주요 내용, 등장인물, 사건 흐름을 간략히 입력하세요. AI가 채점할 때 참고합니다."
                  className="w-full p-3 text-sm border border-amber-200 rounded-xl bg-white focus:border-amber-400 outline-none resize-y min-h-[80px] font-medium"
                />
                <p className="text-[11px] text-amber-500 mt-1 font-medium">
                  💡 줄거리가 있을수록 AI 채점의 정확도가 높아져요.
                </p>
              </div>

              {/* 유형별 비율 설정 */}
              <div className="p-4 bg-indigo-50/50 border-b border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <Brain size={16} className="text-indigo-500" />
                  <span className="text-sm font-black text-indigo-700">문제 유형별 출제 비율 설정</span>
                  <span className="text-xs text-indigo-400 ml-auto">총 {total}문제 출제</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { type: '돋보기', color: 'blue', emoji: '🔍' },
                    { type: '탐정', color: 'purple', emoji: '🧠' },
                    { type: '거울', color: 'rose', emoji: '💬' },
                  ].map(({ type, color, emoji }) => (
                    <div key={type} className={`bg-white rounded-xl p-3 border border-${color}-100`}>
                      <div className={`text-xs font-black text-${color}-600 mb-2 flex items-center gap-1`}>
                        {emoji} {type}
                        <span className="ml-auto text-slate-400 font-medium">등록: {actualCounts[type]}개</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="10"
                          value={quota[type] || 0}
                          onChange={(e) => handleSettingsChange(bookName, chapterName, type, e.target.value)}
                          className={`w-14 p-1.5 text-center font-black text-lg border-2 border-${color}-200 rounded-lg outline-none focus:border-${color}-400`}
                        />
                        <span className="text-sm text-slate-500 font-medium">문제</span>
                      </div>
                      {quota[type] > actualCounts[type] && (
                        <p className="text-[10px] text-orange-500 font-bold mt-1">
                          ⚠️ 등록 문제 부족
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-indigo-400 mt-2 font-medium">
                  💡 등록된 문제가 설정 수보다 적으면 있는 문제 모두 출제됩니다.
                </p>
              </div>

              {/* 질문 목록 */}
              <div className="p-4 space-y-4">
                {questions.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">질문이 없습니다.</p>
                )}
                {questions.map((qObj, qIndex) => {
                  const isClassifying = classifyingIndex === `${bookName}-${chapterName}-${qIndex}`;
                  return (
                    <div key={qIndex} className="flex gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 relative group pr-12">
                      <div className="flex flex-col items-center gap-2 shrink-0 w-20">
                        {qObj.createdBy ? (
                          <span className="w-full text-center text-[10px] font-bold text-slate-500 bg-slate-200 rounded px-1 py-1 mt-1 truncate"
                            title={qObj.createdBy + " 학생이 출제함"}>{qObj.createdBy} 출제</span>
                        ) : (
                          <div className="w-8 h-8 bg-indigo-100 text-indigo-600 font-bold rounded-full flex items-center justify-center text-sm">{qIndex + 1}</div>
                        )}
                        <div className="relative w-full">
                          <select
                            value={qObj.type || '돋보기'}
                            onChange={(e) => handleQuestionChange(bookName, chapterName, qIndex, 'type', e.target.value)}
                            className="w-full p-1 text-[11px] font-black rounded border border-slate-300 outline-none text-center bg-white text-slate-700">
                            <option value="돋보기">🔍 돋보기</option>
                            <option value="탐정">🧠 탐정</option>
                            <option value="거울">💬 거울</option>
                          </select>
                          {isClassifying && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded">
                              <Loader2 size={14} className="animate-spin text-indigo-500" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={safeText(qObj.q)}
                          onChange={(e) => handleQuestionChange(bookName, chapterName, qIndex, 'q', e.target.value)}
                          onBlur={(e) => autoClassifyQuestion(bookName, chapterName, qIndex, e.target.value)}
                          placeholder="질문 입력 후 포커스를 벗어나면 AI가 자동 분류해요"
                          className="w-full p-2 text-sm border border-slate-300 rounded focus:border-indigo-500 font-bold outline-none"
                        />
                        <textarea
                          value={safeText(qObj.a)}
                          onChange={(e) => handleQuestionChange(bookName, chapterName, qIndex, 'a', e.target.value)}
                          placeholder="AI가 채점 기준으로 삼을 모범 정답"
                          className="w-full p-2 text-sm border border-slate-300 rounded focus:border-indigo-500 text-slate-600 outline-none resize-y min-h-[60px]"
                        />
                      </div>
                      <button
                        onClick={() => deleteQuestion(bookName, chapterName, qIndex)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 top-1/2 -translate-y-1/2 text-red-400 hover:text-red-600 p-2">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => addQuestion(bookName, chapterName)}
                  className="w-full py-3 border-2 border-dashed border-slate-300 text-slate-500 font-bold rounded-xl hover:border-indigo-400 hover:text-indigo-600 transition-colors flex justify-center items-center gap-2">
                  <Plus size={18} /> 질문 추가하기
                </button>
              </div>
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function TeacherReportTab({ allRecords, studentQuestions, db, appId }) {
  const [selectedStudent, setSelectedStudent] = useState('전체');
  const [selectedBook, setSelectedBook] = useState('전체');

  // 학생 목록 추출
  const studentNames = ['전체', ...new Set(allRecords.map(r => r.studentName))];
  // 책 목록 추출
  const bookNames = ['전체', ...new Set(allRecords.map(r => r.book))];

  // 필터링 (학생 + 책 동시 적용)
  const filteredRecords = allRecords.filter(r => {
    const studentMatch = selectedStudent === '전체' || r.studentName === selectedStudent;
    const bookMatch = selectedBook === '전체' || r.book === selectedBook;
    return studentMatch && bookMatch;
  });

  const myQs = studentQuestions.filter(q => {
    const studentMatch = selectedStudent === '전체' || q.studentName === selectedStudent;
    const bookMatch = selectedBook === '전체' || q.book === selectedBook;
    return studentMatch && bookMatch;
  });

  // 퀴즈 기록 삭제
  const handleDeleteRecord = async (recordId) => {
    if (!window.confirm('이 퀴즈 기록을 통계에서 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reading_quiz_logs', recordId));
    } catch (err) {
      console.error(err);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  // 학생 출제 질문 삭제
  const handleDeleteQuestion = async (questionId) => {
    if (!window.confirm('이 질문 기록을 통계에서 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_questions', questionId));
    } catch (err) {
      console.error(err);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  // ── 그래프 1: 질문 유형별 정답률 ──
  const typeStats = { '돋보기': { correct: 0, total: 0 }, '탐정': { correct: 0, total: 0 }, '거울': { correct: 0, total: 0 } };
  filteredRecords.forEach(record => {
    record.details?.forEach(d => {
      const type = d.questionType || '돋보기';
      if (typeStats[type]) {
        typeStats[type].total++;
        if (d.isCorrect) typeStats[type].correct++;
      }
    });
  });
  const typeChartData = Object.entries(typeStats).map(([type, stat]) => ({
    name: type,
    정답률: stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
    총문항: stat.total,
  }));

  // ── 그래프 2: 회차별 점수 변화 (개인 선택 시) ──
  const scoreChartData = selectedStudent !== '전체'
    ? [...filteredRecords]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((r, i) => ({
          name: `${i + 1}회차`,
          점수: Math.round((r.score / r.total) * 100),
          책: `${r.book} ${r.chapter}`,
        }))
    : [];

  // ── 그래프 3: 출제 질문 유형 분포 변화 ──
  const sortedQs = [...myQs].sort((a, b) => a.timestamp - b.timestamp);
  const half = Math.ceil(sortedQs.length / 2);
  const earlyQs = sortedQs.slice(0, half);
  const lateQs = sortedQs.slice(half);

  const countTypes = (qs) => {
    const counts = { '돋보기': 0, '탐정': 0, '거울': 0 };
    qs.forEach(q => { if (counts[q.type] !== undefined) counts[q.type]++; });
    const total = qs.length || 1;
    return Object.entries(counts).map(([type, count]) => ({
      name: type, 비율: Math.round((count / total) * 100)
    }));
  };

  const earlyTypeData = countTypes(earlyQs);
  const lateTypeData = countTypes(lateQs);
  const COLORS = { '돋보기': '#60a5fa', '탐정': '#a78bfa', '거울': '#f87171' };

  // ── 책별 통계 (전체 보기 시) ──
  const bookStats = bookNames.filter(b => b !== '전체').map(bookName => {
    const bookRecords = filteredRecords.filter(r => r.book === bookName);
    const totalScore = bookRecords.reduce((sum, r) => sum + Math.round((r.score / r.total) * 100), 0);
    const avgScore = bookRecords.length > 0 ? Math.round(totalScore / bookRecords.length) : 0;
    const typeCount = { '돋보기': { correct: 0, total: 0 }, '탐정': { correct: 0, total: 0 }, '거울': { correct: 0, total: 0 } };
    bookRecords.forEach(r => {
      r.details?.forEach(d => {
        const t = d.questionType || '돋보기';
        if (typeCount[t]) { typeCount[t].total++; if (d.isCorrect) typeCount[t].correct++; }
      });
    });
    return {
      name: bookName,
      평균점수: avgScore,
      퀴즈횟수: bookRecords.length,
      typeCount,
    };
  }).filter(b => b.퀴즈횟수 > 0);

  return (
    <div className="space-y-6">

      {/* 필터 영역 */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
        {/* 학생 필터 */}
        <div>
          <span className="font-black text-slate-700 text-sm block mb-2">👤 학생 선택</span>
          <div className="flex gap-2 flex-wrap">
            {studentNames.map(name => (
              <button key={name} onClick={() => setSelectedStudent(name)}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  selectedStudent === name
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* 책 필터 */}
        <div>
          <span className="font-black text-slate-700 text-sm block mb-2">📚 책 선택</span>
          <div className="flex gap-2 flex-wrap">
            {bookNames.map(name => (
              <button key={name} onClick={() => setSelectedBook(name)}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  selectedBook === name
                    ? 'bg-sky-500 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-4 text-sm text-slate-500 font-medium pt-1 border-t border-slate-100">
          <span>총 퀴즈 기록: <strong className="text-indigo-600">{filteredRecords.length}건</strong></span>
          <span>출제한 질문: <strong className="text-purple-600">{myQs.length}건</strong></span>
        </div>
      </div>

      {/* 책별 통계 (전체 보기 시) */}
      {selectedBook === '전체' && bookStats.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="font-black text-lg text-slate-800 mb-4 flex items-center gap-2">
            <span className="text-2xl">📚</span> 책별 평균 점수
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bookStats} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [`${value}%`, '평균 점수']} />
              <Bar dataKey="평균점수" radius={[6, 6, 0, 0]} fill="#38bdf8"
                label={{ position: 'top', formatter: v => `${v}%`, fontSize: 13, fontWeight: 'bold', fill: '#0284c7' }} />
            </BarChart>
          </ResponsiveContainer>

          {/* 책별 유형별 정답률 카드 */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {bookStats.map(book => (
              <div key={book.name} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="font-black text-slate-700 mb-3 text-sm">{book.name}</p>
                <p className="text-xs text-slate-400 mb-2 font-medium">퀴즈 {book.퀴즈횟수}회 · 평균 {book.평균점수}%</p>
                <div className="space-y-1.5">
                  {Object.entries(book.typeCount).map(([type, stat]) => (
                    <div key={type} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 w-12">{type}</span>
                      <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0}%`,
                            backgroundColor: COLORS[type] || '#94a3b8'
                          }}
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-500 w-8 text-right">
                        {stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 그래프 1: 질문 유형별 정답률 */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="font-black text-lg text-slate-800 mb-1 flex items-center gap-2">
          <span className="text-2xl">🔍</span> 질문 유형별 정답률
        </h3>
        <p className="text-sm text-slate-500 mb-4">탐정·거울 유형의 정답률이 높아질수록 깊은 읽기 능력이 향상된 것입니다.</p>
        {filteredRecords.length === 0 ? (
          <p className="text-center text-slate-400 py-8">데이터가 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={typeChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 13 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [`${value}%`, '정답률']} />
              <Bar dataKey="정답률" radius={[6, 6, 0, 0]} fill="#6366f1"
                label={{ position: 'top', formatter: v => `${v}%`, fontSize: 13, fontWeight: 'bold', fill: '#4f46e5' }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 그래프 2: 회차별 점수 변화 */}
      {selectedStudent !== '전체' && scoreChartData.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="font-black text-lg text-slate-800 mb-1 flex items-center gap-2">
            <span className="text-2xl">📈</span> {selectedStudent} 학생 퀴즈 점수 변화
          </h3>
          <p className="text-sm text-slate-500 mb-4">우상향 추세가 나타날수록 학습 효과가 있음을 의미합니다.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={scoreChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => [`${value}%`, '정답률']}
                labelFormatter={(label, payload) => payload?.[0]?.payload?.책 || label}
              />
              <Line type="monotone" dataKey="점수" stroke="#6366f1" strokeWidth={3}
                dot={{ fill: '#6366f1', r: 5 }} activeDot={{ r: 7 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 그래프 3: 출제 질문 유형 변화 */}
      {myQs.length >= 2 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="font-black text-lg text-slate-800 mb-1 flex items-center gap-2">
            <span className="text-2xl">💡</span> 출제 질문 유형 변화 (초반 vs 후반)
          </h3>
          <p className="text-sm text-slate-500 mb-4">탐정·거울 비율 증가 = 사고 심화.</p>
          <div className="grid sm:grid-cols-2 gap-6">
            {[{ label: '초반', data: earlyTypeData, qs: earlyQs }, { label: '후반', data: lateTypeData, qs: lateQs }].map(({ label, data, qs }) => (
              <div key={label}>
                <p className="font-black text-center text-slate-600 mb-2">{label} ({qs.length}건)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={v => `${v}%`} />
                    <Bar dataKey="비율" radius={[4, 4, 0, 0]}
                      label={{ position: 'top', formatter: v => `${v}%`, fontSize: 12, fontWeight: 'bold' }}>
                      {data.map((entry) => (
                        <Cell key={entry.name} fill={COLORS[entry.name] || '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
            <p className="text-sm font-bold text-indigo-800">📊 변화 요약</p>
            <p className="text-sm text-indigo-700 mt-1">
              탐정 질문: {earlyTypeData.find(d => d.name === '탐정')?.비율 || 0}% → {lateTypeData.find(d => d.name === '탐정')?.비율 || 0}%
              &nbsp;|&nbsp;
              거울 질문: {earlyTypeData.find(d => d.name === '거울')?.비율 || 0}% → {lateTypeData.find(d => d.name === '거울')?.비율 || 0}%
            </p>
          </div>
        </div>
      )}

      {/* 학생별 문해력 단계 요약 */}
      {selectedStudent === '전체' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="font-black text-lg text-slate-800 mb-4 flex items-center gap-2">
            <span className="text-2xl">🎯</span> 학생별 문해력 단계
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...new Set(allRecords.map(r => r.studentName))].map(name => {
              const studentRecords = allRecords.filter(r => r.studentName === name);
              const studentQs = studentQuestions.filter(q => q.studentName === name);
              const levelNum = calcLevel(studentRecords, studentQs);
              if (!levelNum) return null;
              const level = LEVELS[levelNum - 1];
              return (
                <div key={name} className={`flex items-center gap-3 p-4 rounded-2xl border-2 ${level.bg} ${level.border}`}>
                  <span className="text-3xl">{level.emoji}</span>
                  <div>
                    <p className="font-black text-slate-700 text-sm">{name}</p>
                    <p className={`font-black text-sm ${level.color}`}>{level.level}단계 · {level.name}</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                      퀴즈 {studentRecords.length}회 · 질문 {studentQs.length}건
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 개별 학생 단계 상세 */}
      {selectedStudent !== '전체' && (() => {
        const studentRecords = allRecords.filter(r => r.studentName === selectedStudent);
        const studentQs = studentQuestions.filter(q => q.studentName === selectedStudent);
        const levelNum = calcLevel(studentRecords, studentQs);
        if (!levelNum) return null;
        const level = LEVELS[levelNum - 1];
        return (
          <div className={`rounded-2xl p-5 border-2 ${level.bg} ${level.border} shadow-sm`}>
            <div className="flex items-center gap-4">
              <span className="text-4xl">{level.emoji}</span>
              <div className="flex-1">
                <p className="text-xs font-black text-slate-400">{selectedStudent} 학생의 현재 단계</p>
                <p className={`text-xl font-black ${level.color}`}>{level.level}단계 · {level.name}</p>
                <p className={`text-sm font-medium ${level.color} mt-1`}>{level.desc}</p>
              </div>
            </div>
            {levelNum < 5 && (
              <div className="mt-3 bg-white/70 rounded-xl p-3 border border-white/50">
                <p className="text-xs font-black text-slate-500 mb-1">다음 단계로 올라가려면?</p>
                <p className={`text-sm font-bold ${level.color}`}>{level.next}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* 퀴즈 기록 목록 (삭제 기능 포함) */}
      {filteredRecords.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="font-black text-lg text-slate-800 mb-4 flex items-center gap-2">
            <span className="text-2xl">📋</span> 퀴즈 기록 목록
            <span className="text-sm font-medium text-slate-400 ml-auto">잘못된 기록은 삭제할 수 있어요</span>
          </h3>
          <div className="space-y-2">
            {filteredRecords.map(record => (
              <div key={record.id}
                className="flex items-center justify-between bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-black text-xs shrink-0">
                    {record.studentName}
                  </div>
                  <span className="text-xs font-bold text-slate-600 truncate">
                    {record.book} · {record.chapter}
                  </span>
                  <span className="text-xs font-bold text-slate-400 shrink-0">
                    {Math.round((record.score / record.total) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[10px] text-slate-400 font-medium hidden sm:block">
                    {formatDateTime(record.timestamp)}
                  </span>
                  <button
                    onClick={() => handleDeleteRecord(record.id)}
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                    title="이 기록 삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 학생 출제 질문 목록 (삭제 기능 포함) */}
      {myQs.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="font-black text-lg text-slate-800 mb-4 flex items-center gap-2">
            <span className="text-2xl">💡</span> 학생 출제 질문 목록
            <span className="text-sm font-medium text-slate-400 ml-auto">잘못된 질문은 삭제할 수 있어요</span>
          </h3>
          <div className="space-y-2">
            {myQs.map(q => (
              <div key={q.id}
                className="flex items-center justify-between bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="bg-purple-100 text-purple-600 px-2 py-0.5 rounded font-black text-xs shrink-0">
                    {q.studentName}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-black shrink-0 ${QUESTION_TYPES[q.type]?.bg} ${QUESTION_TYPES[q.type]?.color}`}>
                    {q.type}
                  </span>
                  <span className="text-xs font-bold text-slate-600 truncate">{q.question}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${q.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {q.status === 'approved' ? '채택됨' : '대기'}
                  </span>
                  <button
                    onClick={() => handleDeleteQuestion(q.id)}
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                    title="이 질문 삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allRecords.length === 0 && (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center text-slate-400 font-medium">
          아직 데이터가 없습니다. 학생들이 퀴즈를 풀면 자동으로 분석 결과가 나타납니다.
        </div>
      )}
    </div>
  );
}