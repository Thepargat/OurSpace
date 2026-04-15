package com.example.ourspace

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litert.tasks.genai.llminference.LlmInference
import java.io.File

@CapacitorPlugin(name = "GemmaLocal")
class GemmaLocalPlugin : Plugin() {
    private var llmInference: LlmInference? = null

    override fun load() {
        super.load()
        setupLlm()
    }

    private fun setupLlm() {
        val modelPath = "/storage/emulated/0/Download/gemma4-e2b.tflite"
        val modelFile = File(modelPath)
        
        if (!modelFile.exists()) {
            // Log error or handle missing file
            return
        }

        val options = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(modelPath)
            .setMaxTokens(1024)
            .setTemperature(0.7f)
            .setRandomSeed(0)
            .build()

        try {
            llmInference = LlmInference.createFromOptions(context, options)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @PluginMethod
    fun generateText(call: PluginCall) {
        val prompt = call.getString("prompt") ?: ""
        if (prompt.isEmpty()) {
            call.reject("Prompt is empty")
            return
        }

        if (llmInference == null) {
            setupLlm()
        }

        if (llmInference == null) {
            call.reject("LlmInference engine not initialized. Ensure model exists at /storage/emulated/0/Download/gemma4-e2b.tflite")
            return
        }

        try {
            val result = llmInference?.generateResponse(prompt)
            val ret = JSObject()
            ret.put("value", result)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Error generating response", e)
        }
    }
}
