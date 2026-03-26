-- Seed admin user (password: Admin@123)
INSERT OR IGNORE INTO users (email, name, password_hash, role) VALUES 
  ('admin@prepmaster.edu', 'Admin User', '$2a$10$placeholder_admin_hash', 'admin');

-- Seed demo student (password: Student@123)
INSERT OR IGNORE INTO users (email, name, password_hash, role) VALUES 
  ('student@prepmaster.edu', 'Alex Johnson', '$2a$10$placeholder_student_hash', 'student');

-- TOEFL Reading Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, passage, options, correct_answer, explanation, time_limit, points, created_by) VALUES
('TOEFL', 'reading', 'multiple_choice', 'medium', 
 'The Industrial Revolution',
 'According to the passage, what was the primary driver of the Industrial Revolution?',
 'The Industrial Revolution, which began in Britain during the 18th century, fundamentally transformed human society. The shift from agrarian and handicraft economies to manufacturing and industry was driven primarily by technological innovations, particularly the development of steam power. James Watt''s improvements to the steam engine in the 1760s allowed factories to be built anywhere, not just near water sources. This led to rapid urbanization as workers moved from rural areas to cities seeking employment. The social consequences were profound: a new middle class emerged, child labor became widespread, and traditional ways of life were permanently altered. The revolution eventually spread to Western Europe and North America, reshaping global trade patterns and establishing the foundations of modern capitalism.',
 '["Technological innovations, especially steam power","Availability of cheap labor","Colonial expansion and resource extraction","Government subsidies for manufacturing"]',
 'Technological innovations, especially steam power',
 'The passage explicitly states the shift was "driven primarily by technological innovations, particularly the development of steam power."',
 1200, 1.0, 1),

('TOEFL', 'reading', 'multiple_choice', 'hard',
 'The Industrial Revolution - Inference',
 'What can be inferred from the passage about James Watt''s steam engine?',
 'The Industrial Revolution, which began in Britain during the 18th century, fundamentally transformed human society. The shift from agrarian and handicraft economies to manufacturing and industry was driven primarily by technological innovations, particularly the development of steam power. James Watt''s improvements to the steam engine in the 1760s allowed factories to be built anywhere, not just near water sources. This led to rapid urbanization as workers moved from rural areas to cities seeking employment. The social consequences were profound: a new middle class emerged, child labor became widespread, and traditional ways of life were permanently altered. The revolution eventually spread to Western Europe and North America, reshaping global trade patterns and establishing the foundations of modern capitalism.',
 '["It made factory location more flexible","It was invented entirely by Watt","It was first used in agriculture","It required proximity to rivers"]',
 'It made factory location more flexible',
 'The passage states factories could be "built anywhere, not just near water sources," implying location flexibility increased.',
 1200, 1.0, 1),

('TOEFL', 'reading', 'multiple_choice', 'easy',
 'Photosynthesis Basics',
 'What is the main product of photosynthesis according to the passage?',
 'Photosynthesis is the process by which green plants and some other organisms convert light energy, usually from the sun, into chemical energy that can be later released to fuel the organism''s activities. This process involves the absorption of carbon dioxide and water, which are converted into glucose and oxygen. The reaction occurs primarily in the chloroplasts of plant cells, where chlorophyll—the green pigment—captures light energy. Glucose produced during photosynthesis serves as the primary energy source for the plant, while oxygen is released as a byproduct into the atmosphere. This oxygen release is what makes photosynthesis essential to life on Earth, as it maintains the atmospheric oxygen that most organisms need for respiration.',
 '["Glucose and oxygen","Carbon dioxide and water","Chlorophyll and light","Nitrogen and glucose"]',
 'Glucose and oxygen',
 'The passage clearly states that carbon dioxide and water "are converted into glucose and oxygen."',
 1200, 1.0, 1);

-- TOEFL Listening Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, options, correct_answer, explanation, time_limit, points, created_by) VALUES
('TOEFL', 'listening', 'multiple_choice', 'medium',
 'Campus Conversation',
 'Listen to the following conversation between a student and a professor. What is the student''s main concern?\n\n[Audio Transcript]\nStudent: "Professor Williams, I''m worried about the upcoming midterm. I''ve been studying but I feel like I don''t fully understand the material on behavioral economics."\nProfessor: "That''s understandable. The concepts can be challenging at first. What specific areas are you struggling with?"\nStudent: "Mainly the concept of loss aversion and how it differs from risk aversion."\nProfessor: "Good that you''ve identified the problem. Loss aversion refers to the tendency to prefer avoiding losses over acquiring gains, while risk aversion is about preferring certainty over uncertainty. Let me explain with an example..."',
 '["Understanding behavioral economics concepts","Preparing for the final exam","Finding study materials","Getting an extension on an assignment"]',
 'Understanding behavioral economics concepts',
 'The student explicitly states concern about understanding "the material on behavioral economics."',
 600, 1.0, 1),

('TOEFL', 'listening', 'multiple_choice', 'medium',
 'Academic Lecture - Climate',
 'What does the professor say about the relationship between deforestation and climate change?\n\n[Audio Transcript]\nProfessor: "Today we''re examining the interconnected nature of deforestation and climate change. Forests act as carbon sinks, absorbing significant amounts of CO2 from the atmosphere. When forests are cleared, not only do we lose this carbon-absorbing capacity, but the stored carbon is released back into the atmosphere during burning or decomposition. This creates what scientists call a double impact—reduced absorption combined with increased emissions. Studies show that deforestation accounts for approximately 10-15% of global greenhouse gas emissions annually."',
 '["Deforestation has a double negative impact on climate","Forests absorb more CO2 than previously thought","Climate change causes more deforestation","Deforestation occurs mainly in tropical regions"]',
 'Deforestation has a double negative impact on climate',
 'The professor describes a "double impact"—reduced CO2 absorption plus increased emissions from cleared forests.',
 600, 1.0, 1);

-- TOEFL Writing Questions  
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, time_limit, points, created_by) VALUES
('TOEFL', 'writing', 'integrated', 'medium',
 'Independent Task - Technology in Education',
 'Do you agree or disagree with the following statement?\n\n"Technology has made it easier for students to learn compared to previous generations."\n\nUse specific reasons and examples to support your answer. Write at least 300 words.',
 1800, 5.0, 1),

('TOEFL', 'writing', 'independent', 'hard',
 'Integrated Task - Remote Work',
 'Read the passage and listen to the lecture, then write a response explaining how the points made in the lecture cast doubt on the reading passage.\n\nReading Passage:\nRemote work has become increasingly popular in recent years, with many companies reporting higher productivity from remote employees. Studies suggest that workers save time on commuting and experience fewer interruptions than in traditional office settings. Additionally, companies benefit from reduced overhead costs associated with maintaining large office spaces.\n\nYour Task: Summarize the points made in the lecture and explain how they challenge the claims in the reading. Write 150-225 words.',
 1200, 5.0, 1);

-- TOEFL Speaking Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, time_limit, points, created_by) VALUES
('TOEFL', 'speaking', 'independent', 'medium',
 'Task 1 - Personal Preference',
 'Some people prefer to work in a team, while others prefer to work independently. Which do you prefer and why?\n\nPreparation time: 15 seconds\nResponse time: 45 seconds\n\nKey points to address:\n• State your preference clearly\n• Provide 2-3 specific reasons\n• Use examples from your experience',
 60, 4.0, 1),

('TOEFL', 'speaking', 'integrated', 'hard',
 'Task 2 - Campus Announcement',
 'The university has announced a new policy requiring all students to complete 40 hours of community service before graduation. The man in the conversation expresses his opinion about this policy.\n\n[Reading: University Announcement]\nStarting next semester, all undergraduate students must complete 40 hours of approved community service as a graduation requirement. This initiative aims to develop civic responsibility and provide students with practical experience.\n\nDescribe the man''s opinion about the new policy and explain the reasons he gives for his position.\n\nPreparation time: 30 seconds\nResponse time: 60 seconds',
 90, 4.0, 1);

-- IELTS Reading Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, passage, options, correct_answer, explanation, time_limit, points, created_by) VALUES
('IELTS', 'reading', 'multiple_choice', 'medium',
 'The Psychology of Decision Making',
 'According to the passage, what is "cognitive bias"?',
 'The Psychology of Decision Making\n\nHuman beings like to think of themselves as rational actors, making decisions based on careful analysis of available information. However, decades of research in behavioral psychology have revealed that our decision-making processes are frequently influenced by cognitive biases—systematic patterns of deviation from rationality in judgment. These biases often arise from the mental shortcuts, known as heuristics, that our brains use to simplify complex information processing.\n\nOne of the most well-documented cognitive biases is confirmation bias, the tendency to search for and interpret information in a way that confirms one''s preexisting beliefs. Another common bias is the availability heuristic, where people judge the likelihood of events based on how easily examples come to mind. For instance, people tend to overestimate the frequency of dramatic events like plane crashes, which receive extensive media coverage, while underestimating more common but less reported dangers.\n\nUnderstanding these biases has practical implications across many fields, from medicine and law to economics and public policy. Healthcare professionals, for example, must be aware of anchoring bias—the tendency to rely too heavily on the first piece of information encountered—when making diagnoses.',
 '["Rational patterns of decision-making","Systematic deviations from rational judgment","Mental shortcuts that improve decisions","Statistical errors in data analysis"]',
 'Systematic deviations from rational judgment',
 'The passage defines cognitive biases as "systematic patterns of deviation from rationality in judgment."',
 1200, 1.0, 1),

('IELTS', 'reading', 'true_false', 'medium',
 'The Psychology of Decision Making - T/F/NG',
 'The availability heuristic causes people to underestimate the frequency of plane crashes.',
 'The Psychology of Decision Making\n\nHuman beings like to think of themselves as rational actors, making decisions based on careful analysis of available information. However, decades of research in behavioral psychology have revealed that our decision-making processes are frequently influenced by cognitive biases—systematic patterns of deviation from rationality in judgment. These biases often arise from the mental shortcuts, known as heuristics, that our brains use to simplify complex information processing.\n\nOne of the most well-documented cognitive biases is confirmation bias, the tendency to search for and interpret information in a way that confirms one''s preexisting beliefs. Another common bias is the availability heuristic, where people judge the likelihood of events based on how easily examples come to mind. For instance, people tend to overestimate the frequency of dramatic events like plane crashes, which receive extensive media coverage, while underestimating more common but less reported dangers.',
 '["True","False","Not Given"]',
 'False',
 'The passage states people "overestimate the frequency of dramatic events like plane crashes," not underestimate.',
 1200, 1.0, 1);

-- IELTS Writing Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, time_limit, points, created_by) VALUES
('IELTS', 'writing', 'task1', 'medium',
 'Task 1 - Bar Chart Description',
 'The bar chart below shows the percentage of households in owned and rented accommodation in England and Wales between 1918 and 2011.\n\n[Chart Description: The chart shows data for years 1918, 1939, 1953, 1961, 1971, 1981, 1991, 2001, 2011. Owner-occupied housing grew from about 23% in 1918 to 68% in 2001, then declined to 64% in 2011. Private rented accommodation declined from 76% in 1918 to 11% in 2001. Social renting grew from minimal levels to about 20% by 1981 then declined.]\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.',
 1200, 5.0, 1),

('IELTS', 'writing', 'task2', 'hard',
 'Task 2 - Opinion Essay',
 'Some people believe that universities should focus on providing academic knowledge and skills, while others think that universities should also prepare students for employment.\n\nDiscuss both views and give your own opinion.\n\nWrite at least 250 words.',
 2400, 5.0, 1);

-- IELTS Speaking Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, time_limit, points, created_by) VALUES
('IELTS', 'speaking', 'part1', 'easy',
 'Part 1 - Personal Questions',
 'Answer the following personal questions as you would in the IELTS Speaking exam.\n\n1. Let''s talk about your hometown. Where are you from?\n2. Do you like living there? Why or why not?\n3. What is your favorite place to visit in your hometown?\n4. Has your hometown changed much in recent years?\n\nTip: Give natural, conversational answers. Aim for 2-3 sentences per question.',
 300, 3.0, 1),

('IELTS', 'speaking', 'part2', 'medium',
 'Part 2 - Long Turn',
 'Describe a time when you helped someone.\n\nYou should say:\n• Who you helped\n• How you helped them\n• Why they needed help\n• And explain how you felt after helping them\n\nPreparation time: 1 minute\nSpeaking time: 1-2 minutes\n\nYou may use the notes card to make brief notes during preparation time.',
 180, 4.0, 1),

('IELTS', 'speaking', 'part3', 'hard',
 'Part 3 - Discussion',
 'Let''s discuss the topic of helping others more generally.\n\n1. Why do you think some people are more willing to help others than others?\n2. How important is it for governments to encourage volunteering?\n3. Do you think people in cities are less likely to help strangers than people in rural areas? Why?\n4. How has the internet changed the way people help others?\n\nTip: Develop your answers with reasons and examples. Show your ability to discuss abstract topics.',
 300, 4.0, 1);

-- IELTS Listening Questions
INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, options, correct_answer, explanation, time_limit, points, created_by) VALUES
('IELTS', 'listening', 'multiple_choice', 'medium',
 'Section 1 - Booking a Tour',
 'Listen to a conversation between a travel agent and a customer booking a tour.\n\n[Audio Transcript]\nAgent: "Good morning, Adventure Tours. How can I help you?"\nCustomer: "Hi, I''d like to book a tour to Scotland for next month."\nAgent: "Certainly! We have three options. The 3-day Highland tour costs £285 per person, the 5-day coastal tour is £420, and our premium 7-day full Scotland tour is £680."\nCustomer: "What does the 5-day tour include?"\nAgent: "It includes accommodation at 4-star hotels, all breakfasts and dinners, transport by coach, and guided visits to Edinburgh Castle, Loch Ness, and the Isle of Skye."\nCustomer: "That sounds perfect. I''ll take two places on the 5-day tour."\n\nHow much will the customer pay in total?',
 '["£420","£840","£680","£570"]',
 '£840',
 'The 5-day tour costs £420 per person and the customer is booking for 2 people: £420 × 2 = £840.',
 600, 1.0, 1),

('IELTS', 'listening', 'fill_blank', 'medium',
 'Section 2 - Community Announcement',
 'Listen to a community center announcement and complete the notes.\n\n[Audio Transcript]\nAnnouncer: "Welcome to the Riverside Community Center. We''re pleased to announce our new spring program schedule. The yoga class will be held every Tuesday and Thursday at 7:30 in the morning. The fee is £15 per month for members or £25 for non-members. Please note that all participants must bring their own yoga mat. The swimming pool will be open from Monday to Saturday, 6 AM to 9 PM. Children under 12 must be accompanied by an adult at all times. Registration for all programs opens on the first Monday of April."\n\nComplete the notes:\nYoga class days: Tuesday and ___________',
 '["Monday","Wednesday","Thursday","Friday"]',
 'Thursday',
 'The announcement states the yoga class is "every Tuesday and Thursday."',
 600, 1.0, 1);
