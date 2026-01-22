
export const getModifiedMatlabCode = () => {
  return `classdef SignalGenPro < matlab.apps.AppBase

    % Properties to hold UI components and State
    properties (Access = public)
        UIFigure             matlab.ui.Figure
        GridLayout           matlab.ui.container.GridLayout
        LeftPanel            matlab.ui.container.Panel
        RightPanel           matlab.ui.container.Panel
        
        % Signal Configuration UI Handles (Struct Arrays for 3 signals)
        SignalPanels         matlab.ui.container.Panel
        Checkboxes           matlab.ui.control.CheckBox
        TypeDropDowns        matlab.ui.control.DropDown
        FreqFields           matlab.ui.control.NumericEditField
        BWFields             matlab.ui.control.NumericEditField
        PulseWidthFields     matlab.ui.control.NumericEditField
        AmpFields            matlab.ui.control.NumericEditField
        
        % Transmission UI
        IntervalField        matlab.ui.control.NumericEditField
        TotalDurationField   matlab.ui.control.NumericEditField
        GenerateBtn          matlab.ui.control.Button
        TransmitBtn          matlab.ui.control.Button
        StopBtn              matlab.ui.control.Button
        SaveWavBtn           matlab.ui.control.Button
        
        % Plots
        TimeAxes             matlab.ui.control.UIAxes
        FreqAxes             matlab.ui.control.UIAxes
        
        % Data State
        SampleRate           double = 44100
        GeneratedAudio       double
        DisplayMaxFreq       double = 22050
        
        % Audio State
        AudioTimer           timer
        AudioPlayerObj       
        IsTransmitting       logical = false
    end

    methods (Access = private)
        
        % --- 1. Signal Generation Logic ---
        function generateSignals(app)
            totalSignal = [];
            maxFreqInSignal = 0;
            gapSeconds = 0.05; 
            gapSamples = round(gapSeconds * app.SampleRate);
            
            hasActive = false;
            
            for i = 1:3
                if ~app.Checkboxes(i).Value, continue; end
                hasActive = true;
                
                type = app.TypeDropDowns(i).Value;
                f0 = app.FreqFields(i).Value;
                bw = app.BWFields(i).Value;
                tau = app.PulseWidthFields(i).Value;
                amp = app.AmpFields(i).Value;
                
                t = 0 : (1/app.SampleRate) : (tau - 1/app.SampleRate);
                if isempty(t), t = 0; end
                
                if strcmp(type, 'CW')
                    phase = 2 * pi * f0 * t;
                    currentMaxF = f0;
                else
                    if strcmp(type, 'LFM Up')
                        f_start = f0 - bw/2;
                        k = bw / tau;
                    else % LFM Down
                        f_start = f0 + bw/2;
                        k = -bw / tau;
                    end
                    phase = 2 * pi * (f_start .* t + 0.5 * k .* t.^2);
                    currentMaxF = f0 + bw/2;
                end
                
                pulse = amp * cos(phase);
                if currentMaxF > maxFreqInSignal, maxFreqInSignal = currentMaxF; end
                
                if isempty(totalSignal)
                    totalSignal = pulse;
                else
                    totalSignal = [totalSignal, zeros(1, gapSamples), pulse];
                end
            end
            
            if ~hasActive
                totalSignal = zeros(1, 1000); 
                maxFreqInSignal = 1000;
            end
            
            app.GeneratedAudio = totalSignal;
            limit = maxFreqInSignal * 1.2;
            if limit > app.SampleRate/2, limit = app.SampleRate/2; end
            if limit < 1000, limit = 1000; end
            app.DisplayMaxFreq = limit;
            
            app.updatePlots();
            app.TransmitBtn.Enable = hasActive;
            app.SaveWavBtn.Enable = hasActive;
        end
        
        % --- 2. Plotting Logic ---
        function updatePlots(app)
            y = app.GeneratedAudio;
            fs = app.SampleRate;
            t_vec = (0:length(y)-1) / fs;
            
            plot(app.TimeAxes, t_vec, y, 'LineWidth', 1, 'Color', [0, 0.4470, 0.7410]);
            app.TimeAxes.XLim = [0, max(t_vec)];
            app.TimeAxes.YLim = [-1.1, 1.1];
            title(app.TimeAxes, 'Time Domain Signal');
            xlabel(app.TimeAxes, 'Time (s)');
            ylabel(app.TimeAxes, 'Amplitude');
            grid(app.TimeAxes, 'on');
            
            [s, f, t_spec] = spectrogram(y, kaiser(min(1024, length(y)),5), [], 1024, fs);
            P = 20*log10(abs(s) + eps);
            imagesc(app.FreqAxes, t_spec, f, P);
            set(app.FreqAxes, 'YDir', 'normal'); 
            colormap(app.FreqAxes, jet);
            ylim(app.FreqAxes, [0, app.DisplayMaxFreq]);
            title(app.FreqAxes, 'Spectrogram');
            xlabel(app.FreqAxes, 'Time (s)');
            ylabel(app.FreqAxes, 'Frequency (Hz)');
        end
        
        % --- 3. Transmission Logic (Modified for Intermittent Playback) ---
        function startTransmission(app)
            if app.IsTransmitting, return; end
            
            burstDur = length(app.GeneratedAudio) / app.SampleRate;
            interval = app.IntervalField.Value;
            period = burstDur + interval;
            totalDuration = app.TotalDurationField.Value;
            
            % Calculate how many cycles to play
            numCycles = ceil(totalDuration / period);
            
            app.IsTransmitting = true;
            app.updateButtonState();
            
            totalSamples = round(period * app.SampleRate);
            paddedSignal = zeros(1, totalSamples);
            paddedSignal(1:length(app.GeneratedAudio)) = app.GeneratedAudio;
            
            app.AudioPlayerObj = audioplayer(paddedSignal, app.SampleRate);
            
            app.AudioTimer = timer(...
                'ExecutionMode', 'fixedRate', ...
                'Period', period, ...
                'TasksToExecute', numCycles, ...
                'TimerFcn', @(~,~) play(app.AudioPlayerObj), ...
                'StopFcn', @(t,~) app.stopTransmission());
            
            play(app.AudioPlayerObj);
            start(app.AudioTimer);
        end
        
        function stopTransmission(app)
            if ~app.IsTransmitting, return; end
            try
                stop(app.AudioTimer);
                delete(app.AudioTimer);
            catch
            end
            app.IsTransmitting = false;
            app.updateButtonState();
        end

        % --- 4. File Saving Logic (New Feature) ---
        function saveFullWavFile(app)
            burstDur = length(app.GeneratedAudio) / app.SampleRate;
            interval = app.IntervalField.Value;
            period = burstDur + interval;
            totalDuration = app.TotalDurationField.Value;
            
            % Build the full signal
            numCycles = floor(totalDuration / period);
            if numCycles < 1
                uialert(app.UIFigure, 'Total duration is too short for one cycle!', 'Error');
                return;
            end
            
            % Construct cycle with silence
            cycleSamples = round(period * app.SampleRate);
            burstSamples = length(app.GeneratedAudio);
            oneCycle = zeros(1, cycleSamples);
            oneCycle(1:burstSamples) = app.GeneratedAudio;
            
            % Full array (limit size to 1 minute to prevent memory issues)
            if totalDuration > 300
                uialert(app.UIFigure, 'WAV generation limited to 5 minutes for safety.', 'Info');
                totalDuration = 300;
                numCycles = floor(totalDuration / period);
            end
            
            fullSignal = repmat(oneCycle, 1, numCycles);
            
            % Save Dialog
            [file, path] = uiputfile('*.wav', 'Save Pulsed Signal As');
            if isequal(file, 0) || isequal(path, 0), return; end
            
            fullpath = fullfile(path, file);
            try
                audiowrite(fullpath, fullSignal, app.SampleRate);
                uialert(app.UIFigure, ['File saved successfully to: ' char(fullpath)], 'Success');
            catch ME
                uialert(app.UIFigure, ['Failed to save file: ' ME.message], 'Error');
            end
        end
        
        function updateButtonState(app)
            state = 'on'; if app.IsTransmitting, state = 'off'; end
            app.TransmitBtn.Enable = state;
            app.GenerateBtn.Enable = state;
            app.IntervalField.Enable = state;
            app.TotalDurationField.Enable = state;
            app.SaveWavBtn.Enable = state;
            
            if app.IsTransmitting
                app.StopBtn.Enable = 'on';
            else
                app.StopBtn.Enable = 'off';
            end
        end

        function createUI(app)
            app.UIFigure = uifigure('Name', 'SignalGen Pro (Enhanced)', 'Position', [100, 100, 1000, 750]);
            app.UIFigure.Color = [0.1, 0.1, 0.15];
            
            app.GridLayout = uigridlayout(app.UIFigure, [1, 2]);
            app.GridLayout.ColumnWidth = {340, '1x'};
            app.GridLayout.Padding = [10, 10, 10, 10];
            app.GridLayout.BackgroundColor = [0.1, 0.1, 0.15];
            
            app.LeftPanel = uipanel(app.GridLayout);
            app.LeftPanel.BackgroundColor = [0.15, 0.15, 0.2];
            app.LeftPanel.BorderType = 'none';
            
            scrollGrid = uigridlayout(app.LeftPanel, [5, 1]); 
            scrollGrid.RowHeight = {'fit', 'fit', 'fit', 'fit', '1x'}; 
            scrollGrid.Padding = [5 5 5 5];
            scrollGrid.Scrollable = 'on';
            scrollGrid.BackgroundColor = [0.15, 0.15, 0.2];
            
            for i = 1:3, app.createSignalBlock(scrollGrid, i); end
            app.createTransmissionBlock(scrollGrid);
            
            app.RightPanel = uipanel(app.GridLayout);
            app.RightPanel.BackgroundColor = [0.1, 0.1, 0.15];
            app.RightPanel.BorderType = 'none';
            
            plotGrid = uigridlayout(app.RightPanel, [2, 1]);
            plotGrid.RowHeight = {'1x', '1x'};
            plotGrid.Padding = [10, 10, 10, 10];
            plotGrid.BackgroundColor = [0.1, 0.1, 0.15];
            
            app.TimeAxes = uiaxes(plotGrid);
            app.TimeAxes.Color = [0.2, 0.2, 0.25];
            app.TimeAxes.XColor = [0.8, 0.8, 0.8];
            app.TimeAxes.YColor = [0.8, 0.8, 0.8];
            title(app.TimeAxes, 'Time Domain', 'Color', 'w');
            
            app.FreqAxes = uiaxes(plotGrid);
            app.FreqAxes.Color = [0.2, 0.2, 0.25];
            app.FreqAxes.XColor = [0.8, 0.8, 0.8];
            app.FreqAxes.YColor = [0.8, 0.8, 0.8];
            title(app.FreqAxes, 'Spectrogram', 'Color', 'w');
        end
        
        function createSignalBlock(app, parentGrid, id)
            p = uipanel(parentGrid);
            p.Title = sprintf('Signal %d', id);
            p.BackgroundColor = [0.2, 0.2, 0.25];
            p.ForegroundColor = 'white';
            p.FontWeight = 'bold';
            
            g = uigridlayout(p, [6, 2]);
            g.RowHeight = {25, 25, 25, 25, 25, 25};
            g.ColumnWidth = {'1x', '1.5x'};
            g.BackgroundColor = [0.2, 0.2, 0.25];
            
            uilabel(g, 'Text', 'Active:', 'FontColor', [0.8 0.8 0.8]);
            app.Checkboxes(id) = uicheckbox(g, 'Text', '', 'Value', (id==1));
            
            uilabel(g, 'Text', 'Type:', 'FontColor', [0.8 0.8 0.8]);
            app.TypeDropDowns(id) = uidropdown(g, 'Items', {'LFM Up', 'LFM Down', 'CW'});
            
            uilabel(g, 'Text', 'Center Freq (Hz):', 'FontColor', [0.8 0.8 0.8]);
            app.FreqFields(id) = uieditfield(g, 'numeric', 'Value', 1000 * id);
            
            uilabel(g, 'Text', 'Bandwidth (Hz):', 'FontColor', [0.8 0.8 0.8]);
            app.BWFields(id) = uieditfield(g, 'numeric', 'Value', 500);
            
            uilabel(g, 'Text', 'Pulse Width (s):', 'FontColor', [0.8 0.8 0.8]);
            app.PulseWidthFields(id) = uieditfield(g, 'numeric', 'Value', 0.5);
            
            uilabel(g, 'Text', 'Amplitude (0-1):', 'FontColor', [0.8 0.8 0.8]);
            app.AmpFields(id) = uieditfield(g, 'numeric', 'Value', 0.8);
        end
        
        function createTransmissionBlock(app, parentGrid)
            p = uipanel(parentGrid);
            p.Title = 'Transmission Control';
            p.BackgroundColor = [0.15, 0.15, 0.2];
            p.ForegroundColor = [0.4 0.8 1.0];
            p.FontWeight = 'bold';
            
            g = uigridlayout(p, [5, 2]);
            g.RowHeight = {25, 25, 35, 35, 35};
            g.BackgroundColor = [0.15, 0.15, 0.2];
            
            uilabel(g, 'Text', 'Interval Gap (s):', 'FontColor', 'white');
            app.IntervalField = uieditfield(g, 'numeric', 'Value', 2.0, 'Limits', [0 3600]);
            
            uilabel(g, 'Text', 'Total Duration (s):', 'FontColor', 'white');
            app.TotalDurationField = uieditfield(g, 'numeric', 'Value', 10.0, 'Limits', [0.1 86400]);
            
            app.GenerateBtn = uibutton(g, 'Text', '1. Generate Burst', 'BackgroundColor', [0.3 0.3 0.8], 'FontColor', 'white', 'ButtonPushedFcn', @(~,~) app.generateSignals());
            app.GenerateBtn.Layout.Column = [1 2];
            
            app.TransmitBtn = uibutton(g, 'Text', '2. Start Intermittent Play', 'BackgroundColor', [0 0.6 0.3], 'FontColor', 'white', 'ButtonPushedFcn', @(~,~) app.startTransmission());
            app.StopBtn = uibutton(g, 'Text', 'Stop', 'BackgroundColor', [0.8 0.2 0.2], 'FontColor', 'white', 'Enable', 'off', 'ButtonPushedFcn', @(~,~) app.stopTransmission());
            
            app.SaveWavBtn = uibutton(g, 'Text', '3. Export WAV File', 'BackgroundColor', [0.5 0.5 0.5], 'FontColor', 'white', 'ButtonPushedFcn', @(~,~) app.saveFullWavFile());
            app.SaveWavBtn.Layout.Column = [1 2];
        end
    end

    methods (Access = public)
        function app = SignalGenPro
            createUI(app);
            generateSignals(app);
        end
        function delete(app)
            try stop(app.AudioTimer); delete(app.AudioTimer); catch, end
            delete(app.UIFigure);
        end
    end
end`;
};
