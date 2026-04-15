import { quizConfig, questions } from './quiz-data.js';

const { createApp, ref, computed, onMounted } = Vue;

const App = {
    setup() {
        // --- State ---
        const currentScreen = ref('welcome'); // welcome, quiz, report
        const currentIndex = ref(0);
        const selectedOptions = ref([]);
        const showExplanation = ref(false);
        const history = ref([]); 
        
        // --- Computed ---
        const currentQuestion = computed(() => questions[currentIndex.value]);
        const progressPercentage = computed(() => ((currentIndex.value) / questions.length) * 100);
        const isAnswerCorrect = computed(() => {
            if (!currentQuestion.value) return false;
            const correctOptionIds = currentQuestion.value.options.filter(o => o.isCorrect).map(o => o.id);
            if (currentQuestion.value.type === 'single') {
                return selectedOptions.value.length === 1 && correctOptionIds.includes(selectedOptions.value[0]);
            } else {
                return correctOptionIds.length === selectedOptions.value.length && 
                       correctOptionIds.every(id => selectedOptions.value.includes(id));
            }
        });

        // --- Methods ---
        const startQuiz = () => {
             currentScreen.value = 'quiz';
             currentIndex.value = 0;
             resetTurn();
        };

        const resetTurn = () => {
             selectedOptions.value = [];
             showExplanation.value = false;
        };

        const toggleOption = (id) => {
             if (showExplanation.value) return; 
             if (currentQuestion.value.type === 'single') {
                 selectedOptions.value = [id];
             } else {
                 const index = selectedOptions.value.indexOf(id);
                 if (index > -1) {
                     selectedOptions.value.splice(index, 1);
                 } else {
                     selectedOptions.value.push(id);
                 }
             }
        };

        const submitAnswer = () => {
            if (selectedOptions.value.length === 0) return;
            showExplanation.value = true;
            // Record result (handling array domains in V2)
            history.value.push({
                domains: Array.isArray(currentQuestion.value.domain) ? currentQuestion.value.domain : [currentQuestion.value.domain],
                correct: isAnswerCorrect.value
            });
        };

        const nextQuestion = () => {
            if (currentIndex.value < questions.length - 1) {
                currentIndex.value++;
                resetTurn();
            } else {
                currentScreen.value = 'report';
                postMetrics(); // Auto-save to LLM when reaching report
            }
        };

        // --- Render Markdown & Link Interceptor ---
        const renderMarkdown = (text) => {
             if (!text) return '';
             let html = window.marked ? window.marked.parse(text) : text;
             // Adds special markdown class to a tags
             return html.replace(/<a /g, '<a class="text-zinc-600 underline underline-offset-4 decoration-zinc-300 hover:text-zinc-900 transition-colors cursor-pointer" ');
        };

        onMounted(() => {
            // Global click interception for IDE-agnostic local file opening
            document.body.addEventListener('click', (e) => {
                const aTag = e.target.closest('a');
                if (!aTag) return;
                
                const href = aTag.getAttribute('href');
                if (href && (href.startsWith('/') || href.startsWith('file://') || href.endsWith('.md'))) {
                    e.preventDefault();
                    // Clean file:// prefix if exists to get pure absolute path
                    const absolutePath = href.replace('file://', '');
                    
                    fetch('/api/open-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: absolutePath })
                    })
                    .then(res => {
                        if(!res.ok) console.error("Could not open file", res);
                    })
                    .catch(console.error);
                }
            });
        });

        // --- Analytics (V2 supports cross-domain scoring) ---
        const getReportData = computed(() => {
             const report = {};
             // Initialize domains
             Object.keys(quizConfig.domains).forEach(key => {
                  report[key] = { total: 0, correct: 0, rate: 0, label: quizConfig.domains[key].split(' ')[0] };
             });
             // Calculate (if question has 2 domains, both get updated points)
             history.value.forEach(record => {
                  record.domains.forEach(d => {
                      if (report[d]) {
                          report[d].total++;
                          if (record.correct) report[d].correct++;
                      }
                  });
             });
             Object.keys(report).forEach(key => {
                  const data = report[key];
                  data.rate = data.total > 0 ? (data.correct / data.total) * 100 : 0;
             });
             
             const overallCorrect = history.value.filter(h => h.correct).length;
             const overallTotal = history.value.length;
             const overallRate = overallTotal > 0 ? (overallCorrect / overallTotal) * 100 : 0;
             
             return { domains: report, overallRate, overallCorrect, overallTotal };
        });

        const postMetrics = () => {
             const rawData = getReportData.value;
             const exportJson = JSON.stringify({
                 metrics: {
                     Timestamp: new Date().toISOString(),
                     Score: rawData.overallRate,
                     Domains: rawData.domains
                 }
             }, null, 2);

             fetch('/api/metrics', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: exportJson
             })
             .then(res => res.json())
             .then(data => {
                 console.log("LLM Analytics synced successfully.", data);
             })
             .catch(err => {
                 console.error("LLM Analytics sync failed. Are you running the node server?", err);
             });
        }

        return {
            config: quizConfig,
            currentScreen,
            currentIndex,
            currentQuestion,
            totalQuestions: questions.length,
            progressPercentage,
            selectedOptions,
            showExplanation,
            isAnswerCorrect,
            reportData: getReportData,
            
            startQuiz,
            toggleOption,
            submitAnswer,
            nextQuestion,
            renderMarkdown
        };
    }
};

const app = createApp(App);
app.mount('#app');
